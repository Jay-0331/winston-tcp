import {
	describe,
	expect,
	test,
	beforeAll,
	afterAll,
	beforeEach,
} from 'bun:test'
import winston from 'winston'
import { TcpTransport } from '../TcpTransport'
import type { TCPSocketListener } from 'bun'
import * as os from 'os'

describe('TcpTransport', () => {
	let server: TCPSocketListener
	let receivedMessages: string[]
	let port: number

	beforeAll(async () => {
		port = 9000
		receivedMessages = []
		server = Bun.listen({
			hostname: 'localhost',
			port,
			socket: {
				data(socket, data) {
					receivedMessages = data.toString().split(os.EOL).slice(0, -1)
				},
			},
		})
	})

	afterAll(() => {
		server.stop(true)
	})

	beforeEach(() => {
		receivedMessages = []
	})

	function waitForMessages(count: number, timeout = 2000) {
		return new Promise<void>((resolve, reject) => {
			const start = Date.now()
			const check = () => {
				if (receivedMessages.length >= count) {
					resolve()
				} else if (Date.now() - start > timeout) {
					reject()
				} else {
					setTimeout(check, 10)
				}
			}
			check()
		})
	}

	async function tryCatchAsync<T, E = Error>(
		fn: () => Promise<T>,
	): Promise<[T | null, E | null]> {
		try {
			const result = await fn()
			return [result, null]
		} catch (error) {
			return [null, error as E]
		}
	}

	function tryCatch<T, E = Error>(
		fn: (...args: any) => T,
	): [T | null, E | null] {
		try {
			const result = fn()
			return [result, null]
		} catch (error) {
			return [null, error as E]
		}
	}

	function delay(ms: number): Promise<void> {
		return new Promise<void>((resolve) => setTimeout(resolve, ms))
	}

	test('sends logs over TCP', async () => {
		const transport = new TcpTransport({
			host: 'localhost',
			port,
			retryDelay: 10,
		})

		await new Promise((resolve) => transport.once('connected', resolve))

		const logger = winston.createLogger({
			transports: [transport],
			format: winston.format.json(),
		})

		logger.info('test message 1')
		logger.info('test message 2')
		await waitForMessages(1)

		expect(receivedMessages).toEqual([
			'{\"level\":\"info\",\"message\":\"test message 1\"}',
			'{\"level\":\"info\",\"message\":\"test message 2\"}',
		])
		transport.close()
	})

	test('buffers messages when disconnected', async () => {
		const transport = new TcpTransport({
			host: 'localhost',
			port,
			retryDelay: 10,
			bufferMax: 2,
		})

		// Disconnect server and wait for state update
		server.stop(true)

		await new Promise((resolve) => setTimeout(resolve, 50))

		const logger = winston.createLogger({
			transports: [transport],
			format: winston.format.simple(),
		})

		logger.info('buffered message 1')
		logger.info('buffered message 2')

		// Restart server
		server = Bun.listen({
			hostname: 'localhost',
			port,
			socket: {
				data(socket, data) {
					receivedMessages = data.toString().split(os.EOL).slice(0, -1)
				},
			},
		})

		await waitForMessages(1)

		expect(receivedMessages).toEqual([
			'info: buffered message 1',
			'info: buffered message 2',
		])

		transport.close()
	})

	test('emits buffer overflow error', async () => {
		const transport = new TcpTransport({
			host: 'localhost',
			port,
			bufferMax: 1, // Buffer holds only 1 message
			retryDelay: 10,
		})

		const errors: Error[] = []
		transport.on('error', (err) => errors.push(err))

		// Ensure transport is disconnected before logging
		server.stop(true)
		await new Promise((resolve) => transport.once('disconnected', resolve))

		const logger = winston.createLogger({
			transports: [transport],
			format: winston.format.simple(),
		})

		// First message buffers successfully
		logger.info('message 1')

		// Second message triggers overflow
		tryCatch(() => logger.info('message 2'))

		// Wait for error emission
		await new Promise((resolve) => setTimeout(resolve, 50))

		expect(errors).toHaveLength(1)
		expect(errors[0]?.message).toBe('Buffer overflow')

		transport.close()
	})
})
