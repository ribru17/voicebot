require('dotenv').config()

const Discord = require('discord.js')
const client = new Discord.Client()
const googleSpeech = require('@google-cloud/speech')
const googleSpeechClient = new googleSpeech.SpeechClient()
// const { OpusEncoder } = require('@discordjs/opus')
const { Transform } = require('stream')
const ytdl = require('ytdl-core')


//permissions integer: 8

client.on('ready', () => {
    // console.log("voicebot activated")
    client.user.setPresence({ activity: { name: 'your voice', type: "LISTENING" }, status: 'online' })
})

// code to properly format Discord audio streams
function convertBufferTo1Channel(buffer) {
    const convertedBuffer = Buffer.alloc(buffer.length / 2)
  
    for (let i = 0; i < convertedBuffer.length / 2; i++) {
      const uint16 = buffer.readUInt16LE(i * 4)
      convertedBuffer.writeUInt16LE(uint16, i * 2)
    }
  
    return convertedBuffer
}
  
class ConvertTo1ChannelStream extends Transform {
    constructor(source, options) {
        super(options)
    }

    _transform(data, encoding, next) {
        next(null, convertBufferTo1Channel(data))
    }
}

// simple function to delete n messages from a channel
function deleteN(n, msg) {
    let messagecount = parseInt(n);
    msg.channel.messages.fetch({ limit: messagecount })
    .then(messages => msg.channel.bulkDelete(messages));
}

client.login(process.env.BOT_TOKEN)

// handle text channel messages
client.on("message", async (msg) => {
    if (msg.author.bot) return //don't listen to bot messages

    // manually add bot to voice channel
    if (msg.content == "!voicejoin") {
        if (!msg.member.voice.channel) {
            msg.channel.send("Must be in a voice channel!")
        }
        else {
            msg.member.voice.channel.join()
        }
    }

    // manually kick bot from voice channel
    if (msg.content == "!voiceleave") {
        if (msg.member.voice.channel !== null) {
            msg.member.voice.channel.leave()
        }
    }

    // basic poll command
    if (msg.content.indexOf("!poll ") == 0) {
        msg.react('✅')
        msg.react('❌')
    }

    // basic unmute command
    if (msg.content == "!unmute me") {
        msg.member.edit({ mute: false })
    }

    // play the audio of a specified Youtube video given its URL
    if (msg.content.includes("!voiceplay ")) {
        deleteN(1, msg)
        if (msg.member.voice.channel) {
            const connection = await msg.member.voice.channel.join()
            playFileYoutube(connection, msg.content.substring(9))
        }
        else {
            msg.channel.send("Must be in a voice channel!")
        }
    }

    // stop playing audio
    if (msg.content.includes("!voicestop")) {
      if (msg.member.voice.channel) {
        const connection = await msg.member.voice.channel.join()
        await playFile(connection, 'quiet.mp3')
        deleteN(1, msg)
      }
    }
})

// function to play an audio file to a voice channel
async function playFile(connection, filePath) {
    return new Promise((resolve, reject) => {
        const dispatcher = connection.play(filePath)
        dispatcher.setVolume(1)
        dispatcher.on('start', () => {
            // console.log('Playing')
        })
        dispatcher.on('end', () => {
            resolve()
        })
        dispatcher.on('error', (error) => {
            console.error(error)
            reject(error)
        })
    })
}

// function to play a Youtube video's audio in a voice channel
async function playFileYoutube(connection, url) {
    return new Promise((resolve, reject) => {
        const dispatcher = connection.play(ytdl(url, { quality: 'highestaudio' }));
        dispatcher.setVolume(1)
        dispatcher.on('start', () => {
            // console.log('Playing')
        })
        dispatcher.on('end', () => {
            resolve()
        })
        dispatcher.on('error', (error) => {
            console.error(error)
            reject(error)
        })
    })
}

// handle members muting, deafening, leaving voice channel, etc.
client.on('voiceStateUpdate', async (oldPresence, newPresence) => {
    const member = newPresence.member
    const presence = newPresence
    const memberVoiceChannel = member.voice.channel

    // leave voice channel if the bot is the last user in
    if (oldPresence.channel != null && oldPresence.channel.members.size == 1 && newPresence.channelID == null) {
        oldPresence.channel.leave()
    }
    
    // if the only users in a voice channel are bots, leave the voice channel
    if (oldPresence.channel != null && newPresence.channelID == null) {
        (() => {
            oldPresence.channel.members.forEach(member => {
                if (!member.user.bot) {
                    return
                }
            })
            oldPresence.channel.leave()
        })()
    }

    // do not join null channel
    if (!presence || !memberVoiceChannel || newPresence.channelID == null) {
        return
    }

    const connection = await newPresence.member.voice.channel.join()

    // as of writing, in order to listen to user audio it is necessary to first emit audio into
    // the voice channel. this is odd behavior but is fixed by playing a short dummy file
    await playFile(connection, 'quiet.mp3')
})
  
client.on('guildMemberSpeaking', async (member, speaking) => {
    // console.log("Bitfield: " + speaking.bitfield)
    if (!speaking.bitfield || member.user.bot) {
        return
    }
    const connection = await member.voice.channel.join()
    const receiver = connection.receiver

    // console.log(`I'm listening to ${member.displayName}`)

    // this creates a 16-bit signed PCM, stereo 48KHz stream
    const audioStream = receiver.createStream(member, { mode: 'pcm' })
    const requestConfig = {
        encoding: 'LINEAR16',
        sampleRateHertz: 48000,
        languageCode: 'en-US'
    }
    const request = {
        config: requestConfig
    }

    // implementation of speech-to-text
    const recognizeStream = googleSpeechClient
        .streamingRecognize(request)
        .on('error', console.error)
        .on('data', async response => {
            const transcription = response.results
            .map(result => result.alternatives[0].transcript)
            .join('\n')
            .toLowerCase()
            console.log(`Transcription of ${member.user.username}: ${transcription}`)

            // do some fun things with the transcript

            // if (transcription.includes('some function keyword')) {
            //     someFunc(transcription, connection, member)
            // }
        })

    const convertTo1ChannelStream = new ConvertTo1ChannelStream()

    audioStream.pipe(convertTo1ChannelStream).pipe(recognizeStream)

    audioStream.on('end', async () => {
        //console.log('audioStream end')
    })
})