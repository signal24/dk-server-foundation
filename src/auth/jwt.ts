import { HttpRequest, HttpResponse } from '@deepkit/http';
import { createPrivateKey, createPublicKey } from 'crypto';
import { Algorithm, Bufferable, createDecoder, createSigner, createVerifier, SignerPayload, SignerSync, TokenError, VerifierSync } from 'fast-jwt';

import { getAppConfig } from '../app/resolver';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JwtExtras = Record<string, any>;

interface BaseJwtOptions {
    issuer?: string;
    audience?: string;
}

export interface JwtCookieOptions {
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    domain?: string;
}

interface JwtGenerationOptions<T extends JwtExtras = object> extends BaseJwtOptions {
    id?: string;
    subject: string;
    expiresAt?: Date | number;
    expiryMins?: number;
    payload?: T;
}

interface VerifierOptions extends BaseJwtOptions {
    key: string | Buffer;
    algorithm: Algorithm;
}

export class ParsedJwt<T extends JwtExtras = object> {
    readonly isValid = true;
    id?: string;
    issuer!: string;
    audience?: string;
    subject!: string;
    issuedAtMs!: number;
    get issuedAt() {
        return new Date(this.issuedAtMs * 1000);
    }
    expiresAtMs!: number;
    get expiresAt() {
        return new Date(this.expiresAtMs * 1000);
    }
    payload!: T;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawPayload!: Record<string, any>;
}

export interface InvalidJwtValidationResult {
    isValid: false;
    isDecodable: boolean;
    isSignatureValid?: boolean;
    isPayloadValid?: boolean;
    isNotExpired?: boolean;
}

export type JwtValidationResult<T extends JwtExtras = object> = ParsedJwt<T> | InvalidJwtValidationResult;

interface JWTState {
    shouldVerify: boolean;
    issuerName: string;
    validityMins: number;
    cookieName: string;
    cookieRe: RegExp;
    signer: typeof SignerSync<SignerPayload>;
    verifier: typeof VerifierSync<Bufferable>;
    decoder: ReturnType<typeof createDecoder>;
}

const TokenErrorClasses = {
    decode: [TokenError.codes.invalidPayload, TokenError.codes.malformed, TokenError.codes.invalidType],
    verify: [TokenError.codes.verifyError, TokenError.codes.invalidSignature, TokenError.codes.invalidAlgorithm],
    payload: [TokenError.codes.invalidClaimType, TokenError.codes.invalidClaimValue, TokenError.codes.missingRequiredClaim],
    expiry: [TokenError.codes.expired, TokenError.codes.inactive]
};

export class JWT {
    private static _state?: JWTState;

    private static get state() {
        const appConfig = getAppConfig();
        if (appConfig.AUTH_JWT_ENABLE_VERIFY) {
            if (!appConfig.AUTH_JWT_SECRET && !appConfig.AUTH_JWT_SECRET_B64 && !appConfig.AUTH_JWT_ED_SECRET) {
                throw new Error('AUTH_JWT_SECRET/AUTH_JWT_SECRET_B64/AUTH_JWT_ED_SECRET is not configured');
            }
            if (appConfig.AUTH_JWT_SECRET && appConfig.AUTH_JWT_SECRET_B64) {
                throw new Error('AUTH_JWT_SECRET and AUTH_JWT_SECRET_B64 cannot both be configured');
            }
            if ((appConfig.AUTH_JWT_SECRET || appConfig.AUTH_JWT_SECRET_B64) && appConfig.AUTH_JWT_ED_SECRET) {
                throw new Error('AUTH_JWT_SECRET/AUTH_JWT_SECRET_B64 and AUTH_JWT_ED_SECRET cannot both be configured');
            }
        }

        const shouldVerify = appConfig.AUTH_JWT_ENABLE_VERIFY;
        const cookieName = appConfig.AUTH_JWT_COOKIE_NAME ?? 'jwt';
        const cookieRe = new RegExp('(^|;)[ ]*' + cookieName + '=([^;]+)');
        const issuerName = appConfig.AUTH_JWT_ISSUER ?? 'app';
        const validityMins = appConfig.AUTH_JWT_EXPIRATION_MINS ?? 60;
        const getKey = () =>
            appConfig.AUTH_JWT_SECRET_B64 ? Buffer.from(appConfig.AUTH_JWT_SECRET_B64, 'base64') : (appConfig.AUTH_JWT_SECRET ?? '');
        const signer = createSigner(
            appConfig.AUTH_JWT_ED_SECRET
                ? { algorithm: 'EdDSA', key: `-----BEGIN PRIVATE KEY-----\n${appConfig.AUTH_JWT_ED_SECRET}\n-----END PRIVATE KEY-----` }
                : { key: getKey() }
        );
        const verifier = createVerifier({
            cache: true,
            allowedIss: issuerName,
            ...(appConfig.AUTH_JWT_ED_SECRET
                ? { algorithms: ['EdDSA'], key: this.deriveEdPublicKey(appConfig.AUTH_JWT_ED_SECRET) }
                : { key: getKey() })
        });
        const decoder = createDecoder();
        this._state = { shouldVerify, issuerName, validityMins, cookieName, cookieRe, signer, verifier, decoder };

        Object.defineProperty(this, 'state', { value: this._state });

        return this._state;
    }

    private static deriveEdPublicKey(privateKey: string) {
        const privateKeyObj = createPrivateKey({
            key: `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`,
            format: 'pem',
            type: 'pkcs8'
        });
        const publicKeyObj = createPublicKey({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            key: privateKeyObj as any
        });
        return publicKeyObj.export({ type: 'spki', format: 'pem' });
    }

    static async generate<T extends JwtExtras>(options: JwtGenerationOptions<T>): Promise<string> {
        return this.state.signer({
            ...(options.id ? { jti: options.id } : {}),
            iss: options.issuer ?? this.state.issuerName,
            aud: options.audience,
            sub: options.subject,
            exp: this.getExpirationTs(options),
            ...options.payload
        });
        // todo: ID
    }

    static async generateCookie<T extends JwtExtras>(options: JwtGenerationOptions<T>, response: HttpResponse, cookieOptions?: JwtCookieOptions) {
        const payload = await this.generate(options);
        response.setHeader('set-cookie', `${this.state.cookieName}=${payload}; ${this.buildCookieAttributes(cookieOptions)}`);
    }

    static async clearCookie(response: HttpResponse, cookieOptions?: JwtCookieOptions) {
        response.setHeader(
            'set-cookie',
            `${this.state.cookieName}=invalid; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${this.buildCookieAttributes(cookieOptions)}`
        );
    }

    private static buildCookieAttributes(options?: JwtCookieOptions): string {
        const parts = ['Path=/; HttpOnly'];
        if (options?.secure !== false) parts.push('Secure');
        parts.push(`SameSite=${options?.sameSite ?? 'Lax'}`);
        if (options?.domain) parts.push(`Domain=${options.domain}`);
        return parts.join('; ');
    }

    static createVerifier<T extends JwtExtras = object>(options: VerifierOptions): (token: string) => Promise<JwtValidationResult<T>> {
        const verifier = createVerifier({
            cache: true,
            allowedIss: options.issuer,
            allowedAud: options.audience,
            algorithms: [options.algorithm],
            key:
                typeof options.key === 'string' && !options.key.startsWith('-----BEGIN PUBLIC KEY-----') && options.algorithm === 'EdDSA'
                    ? `-----BEGIN PUBLIC KEY-----\n${options.key}\n-----END PUBLIC KEY-----`
                    : options.key
        });
        return async (token: string) => this.verify(token, verifier);
    }

    static async verify<T extends JwtExtras = object>(token: string, verifier?: JWTState['verifier']): Promise<JwtValidationResult<T>> {
        try {
            verifier = verifier ?? this.state.verifier;
            const result = await verifier(token);
            return this.formatJwtResult<T>(result);
        } catch (err) {
            return this.formatJwtError(err);
        }
    }

    static async decode<T extends JwtExtras = object>(token: string): Promise<JwtValidationResult<T>> {
        try {
            const result = await this.state.decoder(token);
            return this.formatJwtResult<T>(result);
        } catch (err) {
            return this.formatJwtError(err);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static formatJwtResult<T extends JwtExtras = object>(result: any): JwtValidationResult<T> {
        const formatted = new ParsedJwt<T>();
        const { jti, sub, iss, aud, iat, exp, ...payload } = result;
        Object.assign(formatted, {
            id: jti,
            subject: sub,
            issuer: iss,
            audience: aud,
            issuedAtMs: iat,
            expiresAtMs: exp,
            payload,
            rawPayload: result
        });
        return formatted;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static formatJwtError(err: any): InvalidJwtValidationResult {
        if (err instanceof TokenError) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (TokenErrorClasses.decode.includes(err.code as any)) {
                return { isValid: false, isDecodable: false };
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (TokenErrorClasses.verify.includes(err.code as any)) {
                return { isValid: false, isDecodable: true, isSignatureValid: false };
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (TokenErrorClasses.payload.includes(err.code as any)) {
                return { isValid: false, isDecodable: true, isSignatureValid: true, isPayloadValid: false };
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (TokenErrorClasses.expiry.includes(err.code as any)) {
                return { isValid: false, isDecodable: true, isSignatureValid: true, isPayloadValid: true, isNotExpired: false };
            }
        }
        throw err;
    }

    static async process(token: string) {
        return this.state.shouldVerify ? this.verify(token) : this.decode(token);
    }

    static async processWithRequest(request: HttpRequest): Promise<JwtValidationResult | null> {
        if (request.headers.authorization) {
            if (request.headers.authorization.startsWith('Bearer ')) {
                const result = await this.process(request.headers.authorization.substring(7));
                if (result.isValid) {
                    return result;
                }
            }
        }

        if (request.headers.cookie) {
            const matches = request.headers.cookie.match(this.state.cookieRe);
            if (matches) {
                const result = await this.process(matches[2]);
                if (result.isValid) {
                    return result;
                }
            }
        }

        return null;
    }

    private static getExpirationTs(options: JwtGenerationOptions) {
        const expiresMsIn = options.expiresAt instanceof Date ? options.expiresAt.getTime() : options.expiresAt;
        const expiresMs = expiresMsIn ?? Date.now() + (options.expiryMins ?? this.state.validityMins) * 60 * 1000;
        return Math.floor(expiresMs / 1000);
    }
}
