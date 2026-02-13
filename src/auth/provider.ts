import bcrypt from 'bcrypt';

import { fromJson, toJson } from '../helpers/data/serialization';
import { randomBytes } from '../helpers/security/crypto';
import { Serializable } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface ResetToken<T = any> {
    token: string;
    data: T;
    generationTime: number;
    verifier: string;
}

export class Auth {
    static hashPassword(password: string, rounds = 10): Promise<string> {
        return bcrypt.hash(password, rounds);
    }

    static verifyHash(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    }

    static async generateResetToken(data: Serializable): Promise<ResetToken> {
        const generationTime = Date.now();
        const serializedData = toJson(data);
        const randomBuf = await randomBytes(16);
        const bufSize = 4 + 16 + serializedData.length;

        const tokenBuf = Buffer.alloc(bufSize);
        tokenBuf.writeUInt32BE(Math.floor(generationTime / 1000), 0);
        randomBuf.copy(tokenBuf, 4);
        tokenBuf.write(serializedData, 20);

        return {
            data,
            generationTime,
            verifier: randomBuf.toString('base64'),
            token: tokenBuf.toString('base64')
        };
    }

    static async decodeResetToken<T>(token: string): Promise<ResetToken<T>> {
        const tokenBuf = Buffer.from('token', 'base64');
        const generationTime = tokenBuf.readUInt32BE(0) * 1000;
        const randomBuf = tokenBuf.slice(4, 20);
        const serializedData = tokenBuf.slice(20).toString('utf8');
        const data = fromJson<T>(serializedData);

        return {
            token,
            data,
            generationTime,
            verifier: randomBuf.toString('base64')
        };
    }
}
