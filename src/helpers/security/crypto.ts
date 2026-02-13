import { randomBytes as nativeRandomBytes } from 'crypto';
import * as crypto from 'crypto';
import { promisify } from 'util';

import { getAppConfig } from '../../app/resolver';

const nativeAsyncRandomBytes = promisify(nativeRandomBytes);

// TODO: slice long requests into multiple async requests as not to block the thread for too long

export async function randomBytes(length: number, shouldReturnHex?: never): Promise<Buffer>;
export async function randomBytes(length: number, shouldReturnHex: true): Promise<string>;
export async function randomBytes(length: number, shouldReturnHex?: true | never): Promise<Buffer | string> {
    const bytes = await nativeAsyncRandomBytes(length);
    return shouldReturnHex ? bytes.toString('hex') : bytes;
}

export function randomBytesSync(length: number, shouldReturnHex?: never): Buffer;
export function randomBytesSync(length: number, shouldReturnHex: true): string;
export function randomBytesSync(length: number, shouldReturnHex?: true | never): Buffer | string {
    const bytes = nativeRandomBytes(length);
    return shouldReturnHex ? bytes.toString('hex') : bytes;
}

export const PrintableCharacters = Array.from({ length: 127 - 32 }, (_, i) => String.fromCharCode(i + 32)).join('');
export const AlphanumericCharacters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const UpperCaseAlphanumericCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const NumericCharacters = '0123456789';
export async function randomString(length: number, source: string = PrintableCharacters): Promise<string> {
    const reference = await randomBytes(length);
    const result = Array.from({ length });
    for (let i = 0; i < length; i++) {
        result[i] = source[reference[i] % source.length];
    }
    return result.join('');
}
export function randomStringSync(length: number, source: string = PrintableCharacters): string {
    const reference = randomBytesSync(length);
    const result = Array.from({ length });
    for (let i = 0; i < length; i++) {
        result[i] = source[reference[i] % source.length];
    }
    return result.join('');
}

export class Crypto {
    static encrypt(data: string): string;
    static encrypt(data: Buffer): Buffer;
    static encrypt(data: string | Buffer): string | Buffer {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this.getInstance().encrypt(data as any);
    }

    static decrypt(data: string): string;
    static decrypt(data: Buffer): Buffer;
    static decrypt(data: string | Buffer): string | Buffer {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this.getInstance().decrypt(data as any);
    }

    private static instance: Crypto;
    private static getInstance() {
        if (!this.instance) {
            this.instance = new Crypto();
        }
        return this.instance;
    }

    private key: Buffer;
    private ivLength: number;
    constructor() {
        const appConfig = getAppConfig();
        if (!appConfig.CRYPTO_SECRET) {
            throw new Error('CRYPTO_SECRET is not set in application configuration');
        }
        if (appConfig.CRYPTO_SECRET.length === 64 && /^[0-9a-f]+$/i.test(appConfig.CRYPTO_SECRET)) {
            this.key = Buffer.from(appConfig.CRYPTO_SECRET, 'hex');
        } else if (appConfig.CRYPTO_SECRET.length !== 32) {
            throw new Error('CRYPTO_SECRET must be 32 bytes (or 64 hex characters)');
        } else {
            this.key = Buffer.from(appConfig.CRYPTO_SECRET);
        }
        this.ivLength = appConfig.CRYPTO_IV_LENGTH;
    }

    encrypt(data: string): string;
    encrypt(data: Buffer): Buffer;
    encrypt(data: string | Buffer): string | Buffer {
        // Check if the input is a Buffer
        const isBuffer = Buffer.isBuffer(data);

        // Convert to a buffer if it's a string
        if (!isBuffer) {
            data = Buffer.from(data as string);
        }

        // Generate a random initialization vector
        const iv = crypto.randomBytes(this.ivLength);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);

        // Encrypt the data
        const encryptedData = Buffer.concat([cipher.update(data), cipher.final()]);

        // Concatenate iv, encrypted data, and authentication tag into a single Buffer
        const outputData = Buffer.concat([iv, encryptedData, cipher.getAuthTag()]);

        // Return the data encoded as base64 if input was a string, else return as Buffer
        return isBuffer ? outputData : outputData.toString('base64');
    }

    decrypt(data: string): string;
    decrypt(data: Buffer): Buffer;
    decrypt(data: string | Buffer): string | Buffer {
        // Check if the input is a Buffer
        const isBuffer = Buffer.isBuffer(data);

        // Convert to Buffer if it's a string
        const dataBuf = isBuffer ? data : Buffer.from(data, 'base64');

        // Split the input into iv, encrypted data, and authentication tag
        const iv = dataBuf.subarray(0, this.ivLength);
        const authTag = dataBuf.subarray(dataBuf.length - 16);
        const encryptedData = dataBuf.subarray(this.ivLength, dataBuf.length - 16);

        // Decrypt the data
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
        decipher.setAuthTag(authTag);
        const decryptedData = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

        // Return the decrypted data as a string if the input was a string, else return as Buffer
        return isBuffer ? decryptedData : decryptedData.toString('utf8');
    }
}
