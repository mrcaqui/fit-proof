import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3"

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

export function getR2PublicUrl(key: string) {
    const endpoint = import.meta.env.VITE_R2_PUBLIC_URL || import.meta.env.VITE_R2_ENDPOINT
    return `${endpoint}/${key}`
}
