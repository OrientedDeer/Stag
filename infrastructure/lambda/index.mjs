/**
 * Stag Cloud Backup Lambda Handler
 *
 * Single Lambda function that generates pre-signed S3 URLs for backup operations.
 * Deploy as Node.js 20.x runtime with the following IAM permissions:
 *   - s3:PutObject, s3:GetObject, s3:DeleteObject, s3:HeadObject on the backup bucket
 *
 * Environment variables:
 *   - BUCKET_NAME: S3 bucket name (e.g., "stag-cloud-backups")
 *   - URL_EXPIRY: Pre-signed URL expiry in seconds (default: 300)
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME || 'stag-cloud-backups';
const URL_EXPIRY = parseInt(process.env.URL_EXPIRY || '300', 10);

export const handler = async (event) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;

    if (!sub) {
        return response(401, { error: 'Unauthorized: no sub claim in token' });
    }

    const key = `${sub}/backup.enc`;

    try {
        switch (method) {
            case 'POST': {
                // Generate pre-signed PUT URL for uploading encrypted backup
                const command = new PutObjectCommand({
                    Bucket: BUCKET,
                    Key: key,
                    ContentType: 'application/octet-stream',
                });
                const uploadUrl = await getSignedUrl(s3, command, { expiresIn: URL_EXPIRY });
                return response(200, { uploadUrl });
            }

            case 'GET': {
                // Check if backup exists, return pre-signed GET URL if so
                let metadata = { exists: false, timestamp: null, size: null };
                try {
                    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
                    metadata = {
                        exists: true,
                        timestamp: head.LastModified?.toISOString() || null,
                        size: head.ContentLength || null,
                    };
                } catch (err) {
                    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
                        return response(200, { metadata, downloadUrl: null });
                    }
                    throw err;
                }

                const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
                const downloadUrl = await getSignedUrl(s3, command, { expiresIn: URL_EXPIRY });
                return response(200, { downloadUrl, metadata });
            }

            case 'DELETE': {
                await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
                return response(200, { deleted: true });
            }

            default:
                return response(405, { error: `Method ${method} not allowed` });
        }
    } catch (err) {
        console.error('Lambda error:', err);
        return response(500, { error: 'Internal server error' });
    }
};

function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        },
        body: JSON.stringify(body),
    };
}
