import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs"
import P from "pino"
import { Boom } from "@hapi/boom"
import makeWASocket, { WASocket, AuthenticationState, DisconnectReason, AnyMessageContent, BufferJSON, initInMemoryKeyStore, delay } from '../src'

(async () => {
    const Browserss = {
        porisweb: browser => ['Porisweb', browser, '1.0'] as [string, string, string],
    }

    let lastJid = null
    let sock: WASocket | undefined = undefined
    // load authentication state from a file
    const loadState = () => {
        let state: AuthenticationState | undefined = undefined
        try {
            const value = JSON.parse(
                readFileSync('./auth_info_multi.json', { encoding: 'utf-8' }),
                BufferJSON.reviver
            )
            state = {
                creds: value.creds,
                // stores pre-keys, session & other keys in a JSON object
                // we deserialize it here
                keys: initInMemoryKeyStore(value.keys)
            }
        } catch { }
        return state
    }
    // save the authentication state to a file
    const saveState = (state?: any) => {
        console.log('saving pre-keys')
        state = state || sock?.authState
        writeFileSync(
            './auth_info_multi.json',
            // BufferJSON replacer utility saves buffers nicely
            JSON.stringify(state, BufferJSON.replacer, 2)
        )
    }
    // start a connection
    const startSock = () => {
        const sock = makeWASocket({
            logger: P({ level: 'debug' }),
            auth: loadState(),
            printQRInTerminal: true,
            browser: Browserss.porisweb('Chrome')
        })
        sock.ev.on('messages.upsert', async m => {
            console.log('message upsert', JSON.stringify(m, undefined, 2))

            const msg = m.messages[0]
            if (!msg.key.fromMe && m.type === 'notify' && msg.key.remoteJid != 'status@broadcast') {
                console.log('replying to', msg.key.remoteJid)
                await sock!.sendReadReceipt(msg.key.remoteJid, msg.key.participant, [msg.key.id])
                await sendMessageWTyping({ text: 'Hello there!' }, msg.key.remoteJid)
            }

        })
        sock.ev.on('messages.update', m => console.log('message update', m))
        sock.ev.on('presence.update', m => console.log('presence update', m))
        sock.ev.on('chats.update', m => console.log('chats update', m))
        sock.ev.on('contacts.update', m => console.log('contacts update', m))
        return sock
    }

    const standBy = async () => {
        /* individual presence */
        /* if (lastJid === null) {
            console.log('initiate for stand by')
        } else {
            console.log('update presence to', lastJid)
            await sock.sendPresenceUpdate('available', lastJid)
            await delay(3000)
            await sock.sendPresenceUpdate('unavailable', lastJid)
            console.log('presence cleared')
        } */

        /* global presence */
        await sock.sendPresenceUpdate('available')
        await delay(3000)
        await sock.sendPresenceUpdate('unavailable')

        /* repeat */
        setTimeout(async () => {
            await standBy()
        }, 1000 * 60 * 5)
    }

    const sendMessageWTyping = async (msg: AnyMessageContent, jid: string) => {

        await sock.presenceSubscribe(jid)
        await delay(500)

        await sock.sendPresenceUpdate('composing', jid)
        await delay(2000)

        await sock.sendPresenceUpdate('paused', jid)

        await sock.sendMessage(jid, msg)

        // await standBy(jid)
        lastJid = jid
    }

    sock = startSock()
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            // reconnect if not logged out
            if ((lastDisconnect.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
                sock = startSock()
            } else {
                console.log('connection closed')
                if (existsSync('./auth_info_multi.json')) {
                    unlinkSync('./auth_info_multi.json')
                }
                process.exit()
            }
        } else if (connection === 'open') {
            await standBy()
        }
        console.log('connection update', JSON.stringify(update))
        // console.log('connection lastDisconnect', JSON.stringify(lastDisconnect, undefined, 2))
    })
    // listen for when the auth state is updated
    // it is imperative you save this data, it affects the signing keys you need to have conversations
    sock.ev.on('auth-state.update', () => saveState())
})()