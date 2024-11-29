const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel: connectToVoice, VoiceConnectionStatus } = require('@discordjs/voice');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const SERVER_ID = '904546782426570792';
const VOICE_CHANNEL_ID = '1311869888498765884';

async function connectToChannel() {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildVoiceStates
        ]
    });

    try {
        await client.login(BOT_TOKEN);
        console.log('Bot logged in successfully');

        // Wait for client to be ready
        await new Promise(resolve => client.once('ready', resolve));

        const guild = await client.guilds.fetch(SERVER_ID);
        const channel = await guild.channels.fetch(VOICE_CHANNEL_ID);

        if (!channel) {
            console.error('Could not find the voice channel!');
            return;
        }

        console.log(`Attempting to join channel: ${channel.name}`);

        const connection = connectToVoice({
            channelId: VOICE_CHANNEL_ID,
            guildId: SERVER_ID,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log('Successfully connected to the voice channel!');
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log('Disconnected from voice channel');
        });

        connection.on('error', error => {
            console.error('Voice connection error:', error);
        });

        // Keep the script running
        process.stdin.resume();

        // Handle cleanup on exit
        process.on('SIGINT', () => {
            console.log('Disconnecting...');
            connection.destroy();
            client.destroy();
            process.exit();
        });

    } catch (error) {
        console.error('Error:', error);
        client.destroy();
    }
}

connectToChannel(); 