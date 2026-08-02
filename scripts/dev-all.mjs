import { spawn } from 'node:child_process';

const kids = [
	spawn('pnpm', ['dev'], { stdio: 'inherit' }),
	spawn('pnpm', ['dev:ws'], { stdio: 'inherit' })
];

const stop = () => {
	for (const k of kids) k.kill('SIGTERM');
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);
