import {
    LinkChangedEventData,
    ResourceChangedEventDescriptor,
} from 'shortly-shared'

type Bindings = {
    KV: KVNamespace
}

export default {
    // The queue handler is invoked when a batch of messages is ready to be delivered
    async queue(
        batch: MessageBatch<ResourceChangedEventDescriptor>,
        env: Bindings
    ): Promise<void> {
        for (let message of batch.messages) {
            const data = JSON.parse(message.body.data) as LinkChangedEventData
            // create
            try {
                if (data.v === 0) {
                    await env.KV.put(data.short, JSON.stringify(data))
                    message.ack()
                    continue
                } else {
                    let linkJSON = await env.KV.get(data.short)
                    if (linkJSON) {
                        const link = JSON.parse(linkJSON)
                        if (link.v === data.v - 1) {
                            await env.KV.put(
                                data.short,
                                JSON.stringify({ ...link, ...data })
                            )
                            message.ack()
                            continue
                        } else if (link.v === data.v) {
                            // Double delivery already updated
                            message.ack()
                            continue
                        }
                    }
                }
            } catch (err: any) {
                console.log(err)
                // Retry
            }
            message.retry()
        }
    },
} satisfies ExportedHandler<Env, ResourceChangedEventDescriptor>
