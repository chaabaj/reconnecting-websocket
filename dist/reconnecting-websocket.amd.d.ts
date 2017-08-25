declare module "index" {
    interface ReconnectingWebsocket extends WebSocket {
        [key: string]: any;
    }
    export = ReconnectingWebsocket;
}
