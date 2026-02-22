import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"

export const r2Client = new S3Client({
    region: "auto",
    endpoint: import.meta.env.VITE_R2_ENDPOINT,
    credentials: {
        accessKeyId: import.meta.env.VITE_R2_ACCESS_KEY_ID,
        secretAccessKey: import.meta.env.VITE_R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
})

export const R2_BUCKET_NAME = import.meta.env.VITE_R2_BUCKET_NAME as string

export async function deleteR2Object(key: string) {
    const command = new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
    })
    return await r2Client.send(command)
}

export async function listR2ObjectsByPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = []
    let continuationToken: string | undefined

    do {
        const command = new ListObjectsV2Command({
            Bucket: R2_BUCKET_NAME,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        })
        const response = await r2Client.send(command)

        if (response.Contents) {
            for (const obj of response.Contents) {
                if (obj.Key) {
                    keys.push(obj.Key)
                }
            }
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)

    return keys
}

export async function deleteR2ObjectsByPrefix(prefix: string): Promise<number> {
    const keys = await listR2ObjectsByPrefix(prefix)
    const chunkSize = 100

    for (let i = 0; i < keys.length; i += chunkSize) {
        const chunk = keys.slice(i, i + chunkSize)
        await Promise.all(chunk.map((key) => deleteR2Object(key)))
    }

    return keys.length
}

export function getR2PublicUrl(key: string) {
    const endpoint = import.meta.env.VITE_R2_PUBLIC_URL || import.meta.env.VITE_R2_ENDPOINT
    return `${endpoint}/${key}`
}
