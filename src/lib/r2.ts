import { S3Client } from "@aws-sdk/client-s3"

export const r2Client = new S3Client({
    region: "auto",
    endpoint: import.meta.env.VITE_R2_ENDPOINT,
    credentials: {
        accessKeyId: import.meta.env.VITE_R2_ACCESS_KEY_ID,
        secretAccessKey: import.meta.env.VITE_R2_SECRET_ACCESS_KEY,
    },
})

export const R2_BUCKET_NAME = import.meta.env.VITE_R2_BUCKET_NAME as string
