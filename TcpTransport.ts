import TransportStream from 'winston-transport'
import { Socket } from 'net'
import * as os from 'os'
import { MESSAGE } from 'triple-beam'

export interface TcpTransportOptions
	extends TransportStream.TransportStreamOptions {
	host: string
	port: number
	maxRetries?: number // -1 for infinite
	retryDelay?: number // ms
	maxBackoff?: number // ms
	bufferMax?: number // max buffered messages
}

export class TcpTransport extends TransportStream {
	private host: string
	private port: number
	private maxRetries: number
	private retryDelay: number
	private maxBackoff: number
	private bufferMax: number

	private buffer: string[] = []
	private retryCount = 0
	private connected = false
	private closing = false
	private reconnectTimer?: NodeJS.Timeout
	private socket?: Socket

	constructor(options: TcpTransportOptions) {
		super(options)

		this.host = options.host
		this.port = options.port
		this.maxRetries = options.maxRetries ?? -1
		this.retryDelay = options.retryDelay ?? 1000
		this.maxBackoff = options.maxBackoff ?? 30000
		this.bufferMax = options.bufferMax ?? 1000

		this._connect()
	}

	private _connect() {
		if (this.socket) {
			this.socket.destroy()
			this.socket.removeAllListeners()
		}

		this.socket = new Socket()
		this.socket.setKeepAlive(true, 60000)

		this.socket.on('connect', async () => {
			this.connected = true
			this.retryCount = 0
			this._flushBuffer()
			this.emit('connected')
		})

		this.socket.on('error', () => {
			this.connected = false
			this._scheduleReconnect()
		})

		this.socket.on('close', () => {
			this.connected = false
			this.emit('disconnected')
			if (!this.closing) {
				this._scheduleReconnect()
			}
		})

		this.socket.on('timeout', () => {
			this.socket?.destroy()
			this._scheduleReconnect()
		})

		try {
			this.socket.connect(this.port, this.host)
		} catch {
			this._scheduleReconnect()
		}
	}

	private _scheduleReconnect() {
		if (this.closing) return
		if (this.maxRetries >= 0 && this.retryCount >= this.maxRetries) {
			return
		}

		const delay = Math.min(
			this.retryDelay * 2 ** this.retryCount,
			this.maxBackoff,
		)

		if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
		this.reconnectTimer = setTimeout(() => {
			this.retryCount++
			this._connect()
		}, delay)

		this.emit('reconnecting', { delay, attempt: this.retryCount + 1 })
	}

	private _flushBuffer() {
		while (this.buffer.length && this.connected && this.socket) {
			const message = this.buffer.shift()
			if (message) this._safeWrite(message)
		}
	}

	private _safeWrite(message: string) {
		if (!this.socket) return
		try {
			this.socket.write(message)
		} catch (err) {
			// Emit error event for Winston
			this.emit('error', err)
			if (this.buffer.length < this.bufferMax) {
				this.buffer.unshift(message)
			}
			this._scheduleReconnect()
		}
	}

	log(info: any, callback: () => void = () => {}) {
		setImmediate(() => this.emit('logged', info))
		const message = `${info[MESSAGE]}${os.EOL}`

		if (this.connected && this.socket) {
			this._safeWrite(message)
		} else {
			if (this.buffer.length >= this.bufferMax) {
				this.emit('error', new Error('Buffer overflow'))
			} else {
				this.buffer.push(message)
			}
		}
		callback()
	}

	close() {
		this.closing = true
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = undefined
		}
		if (this.socket) {
			this.socket.end(() => {
				this.socket?.destroy()
				this.emit('closed')
			})
		}
	}
}
