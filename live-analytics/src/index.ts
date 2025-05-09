import { DurableObject } from 'cloudflare:workers'
import { appConstants, AuthorizationResult, Scopes } from 'shortly-shared'

export interface Env {
	LA_WEBSOCKET_SERVER: DurableObjectNamespace<LiveAnalytics>
	SERVICE_API_GATEWAY: Service
}

export class LiveAnalytics extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		// Creates two ends of a WebSocket connection.
		const webSocketPair = new WebSocketPair()
		const [client, server] = Object.values(webSocketPair)

		// Calling `acceptWebSocket()` informs the runtime that this WebSocket is to begin terminating
		// request within the Durable Object. It has the effect of "accepting" the connection,
		// and allowing the WebSocket to send and receive messages.
		// Unlike `ws.accept()`, `state.acceptWebSocket(ws)` informs the Workers Runtime that the WebSocket
		// is "hibernatable", so the runtime does not need to pin this Durable Object to memory while
		// the connection is open. During periods of inactivity, the Durable Object can be evicted
		// from memory, but the WebSocket connection will remain open. If at some later point the
		// WebSocket receives a message, the runtime will recreate the Durable Object
		// (run the `constructor`) and deliver the message to the appropriate handler.
		this.ctx.acceptWebSocket(server)

		return new Response(null, {
			status: 101,
			webSocket: client,
		})
	}

	async linkCountUpdated(data: any): Promise<void> {
		for (const ws of this.ctx.getWebSockets()) {
			ws.send(JSON.stringify(data))
		}
	}

	async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
		// This is for testing the connection
		// Relay back message
		const data = {
			message: `Message recieved: ${message}, connections: ${
				this.ctx.getWebSockets().length
			}`,
		}
		ws.send(JSON.stringify(data))
	}

	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean
	) {
		// If the client closes the connection, the runtime will invoke the webSocketClose() handler.
		ws.close(code, 'Server is closing WebSocket')
	}
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		const url = new URL(request.url)
		const parts = url.pathname.slice(1).split('/')
		const token = url.searchParams.get('token')
		const apiKey = url.searchParams.get('apikey')

		if (parts.length > 0 && parts[0] === 'websocket' && (token || apiKey)) {
			// Expect to receive a WebSocket Upgrade request.
			// If there is one, accept the request and return a WebSocket Response.
			const upgradeHeader = request.headers.get('Upgrade')
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				return new Response(
					'Websocket header expected Upgrade: websocket',
					{
						status: 426,
					}
				)
			}
			const auth: AuthorizationResult = token
				? await env.SERVICE_API_GATEWAY.authorizeToken(token)
				: await env.SERVICE_API_GATEWAY.authorizeAPIKey(apiKey)

			if (auth) {
				const scopes = new Set(auth.scopes)
				if (scopes.has(Scopes.ReadAnalytics)) {
					const id = env.LA_WEBSOCKET_SERVER.idFromName(auth.id)
					const stub = env.LA_WEBSOCKET_SERVER.get(id)

					return stub.fetch(request)
				}
			}
		}

		return new Response(null, {
			status: 400,
			statusText: 'Bad Request',
			headers: {
				'Content-Type': 'text/plain',
			},
		})
	},

	async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
		for (const message of batch.messages) {
			const data = message.body
			const id = env.LA_WEBSOCKET_SERVER.idFromName(data.userId)
			const stub = env.LA_WEBSOCKET_SERVER.get(id)
			await stub.linkCountUpdated(data)
			message.ack()
		}
	},
}
