/*!
 * Reconnecting WebSocket
 * by Pedro Ladaria <pedro.ladaria@gmail.com>
 * https://github.com/pladaria/reconnecting-websocket
 * License MIT
 */
type Options = {
    [key: string]: any,
    constructor?: new(url: string, protocols?: string | string[]) => WebSocket;
    maxReconnectionDelay?: number;
    minReconnectionDelay?: number;
    reconnectionDelayGrowFactor?: number;
    connectionTimeout?: number;
    maxRetries?: number;
    debug?: boolean;
};

interface EventListener {
    (event?: any): any;
};

interface EventListeners {
    [key: string]: [EventListener, any][];
};

interface ReconnectingWebsocket extends WebSocket {
    [key: string]: any;
};

const isWebSocket = (constructor: any) =>
    constructor && constructor.CLOSING === 2;

const isGlobalWebSocket = () =>
    typeof WebSocket !== 'undefined' && isWebSocket(WebSocket);

const getDefaultOptions = () => <Options>({
    constructor: isGlobalWebSocket() ? WebSocket : null,
    maxReconnectionDelay: 10000,
    minReconnectionDelay: 1500,
    reconnectionDelayGrowFactor: 1.3,
    connectionTimeout: 4000,
    maxRetries: Infinity,
    debug: false,
});

const bypassProperty = (src: any, dst: any, name: string) => {
    Object.defineProperty(dst, name, {
        get: () => src[name],
        set: (value) => {src[name] = value},
        enumerable: true,
        configurable: true,
    });
};

const initReconnectionDelay = (config: Options) =>
    (config.minReconnectionDelay + Math.random() * config.minReconnectionDelay);

const updateReconnectionDelay = (config: Options, previousDelay: number) => {
    const newDelay = previousDelay * config.reconnectionDelayGrowFactor;
    return (newDelay > config.maxReconnectionDelay)
        ? config.maxReconnectionDelay
        : newDelay;
};

const LEVEL_0_EVENTS = ['onopen', 'onclose', 'onmessage', 'onerror'];

const reassignEventListeners = (ws: ReconnectingWebsocket, oldWs: ReconnectingWebsocket, listeners: EventListeners) => {
    Object.keys(listeners).forEach(type => {
        listeners[type].forEach(([listener, options]) => {
            ws.addEventListener(type, listener, options);
        });
    });
    if (oldWs) {
        LEVEL_0_EVENTS.forEach(name => {
            ws[name] = oldWs[name];
        });
    }
};

class ReconnectingWebSocket {
    private url: string | (() => string)
    private protocols: string | string[]
    private config: Options
    private ws: WebSocket
    private log: (...params: any[]) => void
    private listeners: EventListeners = {};
    private connectingTimeout: number;
    private reconnectDelay = 0;
    private retriesCount = 0;
    private shouldRetry = true;
    private savedOnClose: any = null;
    constructor(url: string | (() => string),
                protocols?: string | string[],
                options = <Options>{}) {
        this.url = url
        this.protocols = protocols

        const defaultOptions = getDefaultOptions()

        this.config = Object.keys(defaultOptions)
            .reduce((mergedConfig, key) => {
                if (options.hasOwnProperty(key))
                    return options[key]
                else
                    return defaultOptions[key]
            }, {})
        if (!isWebSocket(this.config.constructor)) {
            throw new TypeError('Invalid WebSocket constructor. Set `options.constructor`');
        }
        this.log = this.config.debug ? (...params: any[]) => console.log('RWS:', ...params) : () => {};
        this.log('init');
        this.connect();
    }

    private emitError(code: string, msg: string) {
        setTimeout(() => {
            const err = <any>new Error(msg);
            err.code = code;
            if (Array.isArray(this.listeners.error)) {
                this.listeners.error.forEach(([fn]) => fn(err));
            }
            if (this.ws.onerror) {
                this.ws.onerror(err);
            }
        }, 0);
    }

    /**
     * Not using dispatchEvent, otherwise we must use a DOM Event object
     * Deferred because we want to handle the close event before this
     */
    private handleClose() {
        const shouldRetry = this.shouldRetry
        this.log('handleClose', {shouldRetry});
        this.retriesCount++;
        this.log('retries count:', this.retriesCount);
        if (this.retriesCount > this.config.maxRetries) {
            this.emitError('EHOSTDOWN', 'Too many failed connection attempts');
            return;
        }
        if (!this.reconnectDelay) {
            this.reconnectDelay = initReconnectionDelay(this.config);
        } else {
            this.reconnectDelay = updateReconnectionDelay(this.config, this.reconnectDelay);
        }
        this.log('handleClose - reconnectDelay:', this.reconnectDelay);

        if (shouldRetry) {
            setTimeout(() => this.connect, this.reconnectDelay);
        }
    }

    private connect() {
        if (!this.shouldRetry) {
            return;
        }

        this.log('connect');
        const oldWs = this.ws;
        const wsUrl = (typeof this.url === 'function') ? this.url() : this.url;
        this.ws = new (<any>this.config.constructor)(wsUrl, this.protocols);

        this.connectingTimeout = setTimeout(() => {
            this.log('timeout');
            this.ws.close();
            this.emitError('ETIMEDOUT', 'Connection timeout');
        }, this.config.connectionTimeout);

        this.log('bypass properties');
        for (let key in this.ws) {
            // @todo move to constant
            if (['addEventListener', 'removeEventListener', 'close', 'send'].indexOf(key) < 0) {
                bypassProperty(this.ws, this, key);
            }
        }

        this.ws.addEventListener('open', () => {
            clearTimeout(this.connectingTimeout);
            this.log('open');
            this.reconnectDelay = initReconnectionDelay(this.config);
            this.log('reconnectDelay:', this.reconnectDelay);
            this.retriesCount = 0;
        });

        this.ws.addEventListener('close', this.handleClose);

        reassignEventListeners(this.ws, oldWs, this.listeners);

        // because when closing with fastClose=true, it is saved and set to null to avoid double calls
        this.ws.onclose = this.ws.onclose || this.savedOnClose;
        this.savedOnClose = null;
    };

    close(code = 1000, reason = '', {keepClosed = false, fastClose = true, delay = 0} = {}) {
        const retriesCount = this.retriesCount
        this.log('close - params:', {reason, keepClosed, fastClose, delay, retriesCount, maxRetries: this.config.maxRetries});
        this.shouldRetry = !keepClosed && this.retriesCount <= this.config.maxRetries;

        if (delay) {
            this.reconnectDelay = delay;
        }

        this.ws.close(code, reason);

        if (fastClose) {
            const fakeCloseEvent = <CloseEvent>{
                code,
                reason,
                wasClean: true,
            };

            // execute close listeners soon with a fake closeEvent
            // and remove them from the WS instance so they
            // don't get fired on the real close.
            this.handleClose();
            this.ws.removeEventListener('close', this.handleClose);

            // run and remove level2
            if (Array.isArray(this.listeners.close)) {
                this.listeners.close.forEach(([listener, options]) => {
                    listener(fakeCloseEvent);
                    this.ws.removeEventListener('close', listener, options);
                });
            }

            // run and remove level0
            if (this.ws.onclose) {
                this.savedOnClose = this.ws.onclose;
                this.ws.onclose(fakeCloseEvent);
                this.ws.onclose = null;
            }
        }
    }

    send(data: any) {
        this.ws.send(data)
    }

    private addEventListener(type: string, listener: EventListener, options: any) {
        if (Array.isArray(this.listeners[type])) {
            if (!this.listeners[type].some(([l]) => l === listener)) {
                this.listeners[type].push([listener, options]);
            }
        } else {
            this.listeners[type] = [[listener, options]];
        }
        this.ws.addEventListener(type, listener, options);
    }

    private removeEventListener(type: string, listener: EventListener, options: any) {
        if (Array.isArray(this.listeners[type])) {
            this.listeners[type] = this.listeners[type].filter(([l]) => l !== listener);
        }
        this.ws.removeEventListener(type, listener, options);
    }
}

export = ReconnectingWebsocket;
