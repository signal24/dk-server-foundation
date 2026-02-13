import { spawn } from 'child_process';

import { withSpan } from '../../telemetry';
import { toError } from '../utils/error';

interface IExecOptions {
    cwd?: string;
    errorOnNonZero?: boolean;
    stdio?: Parameters<typeof spawn>[2]['stdio'];
    onSpawn?: (proc: ReturnType<typeof spawn>) => void;
    shell?: boolean;
}

interface IExecResult {
    code: number | null;
    stdout: Buffer;
    stderr: Buffer;
}

export async function execProcess(cmd: string, args: string[], options?: IExecOptions): Promise<IExecResult> {
    return withSpan('execProcess', { cmd, args }, async () => {
        try {
            return await new Promise<IExecResult>((resolve, reject) => {
                const stdout: Buffer[] = [];
                const stderr: Buffer[] = [];
                const proc = spawn(cmd, args, { cwd: options?.cwd, stdio: options?.stdio, shell: options?.shell });
                proc.on('error', reject);
                proc.on('spawn', () => options?.onSpawn?.(proc));
                proc.stdout?.on('data', data => stdout.push(data));
                proc.stderr?.on('data', data => stderr.push(data));
                proc.on('exit', code => {
                    if (options?.errorOnNonZero !== false && code !== 0) {
                        reject(new Error(`Process exited with code ${code}`));
                    }
                    resolve({
                        code,
                        stdout: Buffer.concat(stdout),
                        stderr: Buffer.concat(stderr)
                    });
                });
            });
        } catch (err) {
            throw toError(
                `Failure during execution of process with command: ${cmd} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
                err
            );
        }
    });
}
