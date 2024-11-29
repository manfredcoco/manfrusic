require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { 
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    NoSubscriberBehavior,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    getVoiceConnection
} = require('@discordjs/voice');
const { join } = require('path');

if (!process.env.BOT_TOKEN) {
    console.error('BOT_TOKEN is not set in environment variables');
    process.exit(1);
}

const SERVER_ID = '904546782426570792';
const VOICE_CHANNEL_ID = '1311869888498765884';

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

async function setupVoiceConnection() {
    // Destroy any existing connections
    const existingConnection = getVoiceConnection(SERVER_ID);
    if (existingConnection) {
        existingConnection.destroy();
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const connection = joinVoiceChannel({
        channelId: VOICE_CHANNEL_ID,
        guildId: SERVER_ID,
        adapterCreator: client.guilds.cache.get(SERVER_ID).voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
        return connection;
    } catch (error) {
        connection.destroy();
        throw error;
    }
}

async function startPlayback() {
    try {
        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play,
                maxMissedFrames: 200
            }
        });

        const connection = await setupVoiceConnection();
        console.log('Voice connection established');

        const resource = createAudioResource(join(__dirname, 'test.mp3'), {
            inlineVolume: true,
            inputType: 'mp3',
            silencePaddingFrames: 5,
            highWaterMark: 1024 * 1024 * 50  // 50MB buffer
        });
        
        resource.volume?.setVolume(1);
        connection.subscribe(player);

        // Handle connection state changes
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                connection.destroy();
                startPlayback().catch(console.error);
            }
        });

        // Handle player state changes
        player.on(AudioPlayerStatus.Playing, () => {
            console.log('Audio playback started');
        });

        player.on(AudioPlayerStatus.Idle, () => {
            console.log('Playback finished');
            cleanup();
        });

        player.on('error', error => {
            console.error('Player error:', error);
            player.play(resource);
        });

        // Start playback
        player.play(resource);

    } catch (error) {
        console.error('Setup error:', error);
        cleanup();
    }
}

function cleanup() {
    const connection = getVoiceConnection(SERVER_ID);
    if (connection) {
        connection.destroy();
    }
    client.destroy();
    process.exit(0);
}

// Handle process termination
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Handle unhandled errors
process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
    cleanup();
});

client.once('ready', () => {
    console.log('Bot is ready');
    startPlayback().catch(console.error);
});

// Connect with retry logic
async function connectWithRetry(attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        try {
            await client.login(process.env.BOT_TOKEN);
            return;
        } catch (error) {
            if (i === attempts - 1) throw error;
            console.log(`Login attempt ${i + 1} failed, retrying in 5 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

connectWithRetry().catch(error => {
    console.error('Failed to connect after multiple attempts:', error);
    process.exit(1);
}); 