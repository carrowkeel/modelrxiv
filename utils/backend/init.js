'use strict';

const randint = (m,m1,g) => Math.floor(g() * (m1 - m)) + m;
const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const generateID = l => Array.from(new Array(l)).map(v=>letters[randint(0, letters.length, Math.random)]).join('');

const prompt = (text) => {
	process.stdout.write(`${text}: `);
	return new Promise(resolve => {
		process.stdin.on('data', data => {
			resolve(data.toString().replace('\n', ''));
		});
	});
};

const auth = () => new Promise(async (resolve, reject) => {
	process.stdout.write('Modelrxiv.org login\n');
	const user_name = await prompt('Nickname');
	const user_password = await prompt('Password');
	const request = require('https').request({
		hostname: 'd.modelrxiv.org',
		port: 443,
		path: '/auth',
		method: 'POST'
	}, res => {
		res.on('data', data => {
			const auth_data = JSON.parse(data.toString());
			const credentials = {token: auth_data.data.token, user_id: auth_data.data.user_id, cdn: {'Policy': auth_data.data.signed['CloudFront-Policy'], 'Key-Pair-Id': auth_data.data.signed['CloudFront-Key-Pair-Id'], 'Signature': auth_data.data.signed['CloudFront-Signature'], 'expiry': new Date().getTime() + 6 * 3600 * 1000}};
			resolve(credentials);
		});
	});
	request.on('error', e => console.log(e));
	request.write(JSON.stringify({action: 'login', user_name, user_password}));
	request.end();
});

const main = async () => {
	const args = process.argv.slice(2).reduce((a,v)=>Object.assign(a, {[v.split(/[= ]/)[0].replace('--','')]: v.split('=').slice(1).join('=')}), {});
	try {
		const credentials = args.request ? '' : (args.credentials || (await auth()));
		try {
			return require('./apc.js').init(args.url || 'wss://apc.modelrxiv.org', generateID(6), credentials, args.threads ? +(args.threads) : 4, args.name, args.mode, args.request);
		} catch (e) {
			console.log('Failed to initiate APC node', e);
		}
	} catch (e) {
		console.log('Authentication failed');
	}
};

main();