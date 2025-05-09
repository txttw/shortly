import {
    appDefaults,
    LinkChangedEventData,
    LookupCreatedEventData,
} from 'shortly-shared'

// APP CONFIG
// TODO We could read from DB
const appConfig = appDefaults

type Bindings = {
    LOOKUPS_ANALYTICS_QUEUE: Queue
    KV: KVNamespace
}

export default {
    async fetch(req, env: Bindings, ctx): Promise<Response> {
        const url = new URL(req.url)
        const short = url.pathname.slice(1)
        const url404 = 'https://app.shortly.txttw.online/404/'

        if (short.length !== appConfig.shortLength) {
            return Response.redirect(url404, 302)
            //return new Response(null, {status: 400})
        }
        const linkJSON = await env.KV.get(short)
        if (!linkJSON) {
            return Response.redirect(url404, 302)
            //return new Response(null, {status: 404})
        }
        const link = JSON.parse(linkJSON) as LinkChangedEventData

        // If expired or deleted return 404
        if (link.deletedAt || new Date() > new Date(link.expiresAt)) {
            return Response.redirect(url404, 302)
            //return new Response(null, {status: 404})
        }

        const lookup: LookupCreatedEventData = {
            linkId: link.id,
            timestamp: new Date(),
        }

        // This code has to be fast and runs a lot so we dont create DB records for events to be able to retry
        // The queue is high availability, serverless,
        // if we loose very rarely a few messages from analytics its not a big deal from a business perspective
        await env.LOOKUPS_ANALYTICS_QUEUE.send(lookup)

        return Response.redirect(link.long, 302)
    },
} satisfies ExportedHandler<Env>
