export const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms))

export const base64Decode = (
    base64: string,
    encoding: BufferEncoding = 'utf-8'
) => Buffer.from(base64, 'base64').toString(encoding)
