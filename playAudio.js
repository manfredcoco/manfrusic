require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
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
const fs = require('fs');
const Fuse = require('fuse.js');
const WebSocket = require('ws');

if (!process.env.BOT_TOKEN) {
    console.error('BOT_TOKEN is not set in environment variables');
    process.exit(1);
}

const SERVER_ID = '904546782426570792';
const VOICE_CHANNEL_ID = '1311869888498765884';
const MUSIC_DIR = join(__dirname, 'music');
let currentVolume = 1;
let currentPlayer = null;
let playlist = [];
let fuseSearch;
let lastSearchResults = [];
let isConnected = false; // Track connection state
let isSkipping = false;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages
    ]
});

const ws = new WebSocket('ws://localhost:3001');

ws.on('message', (data) => {
    try {
        const message = JSON.parse(data);
        if (message.type === 'fileChange') {
            console.log('Detected file change, reloading playlist');
            loadPlaylist();
        }
    } catch (error) {
        console.error('WebSocket message error:', error);
    }
});

ws.on('error', (error) => {
    console.error('WebSocket error:', error);
});

// Add reconnection logic
ws.on('close', () => {
    console.log('WebSocket disconnected, attempting to reconnect...');
    setTimeout(() => {
        ws = new WebSocket('ws://localhost:3001');
    }, 5000);
});

function stopCurrentPlayback() {
    if (currentPlayer) {
        currentPlayer.stop();
        currentPlayer = null;
    }
}

async function setupVoiceConnection() {
    if (isConnected) {
        console.log('Already connected, stopping current playback');
        stopCurrentPlayback();
        return getVoiceConnection(SERVER_ID);
    }

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
        isConnected = true;
        return connection;
    } catch (error) {
        connection.destroy();
        isConnected = false;
        throw error;
    }
}

function initializeSearch() {
    // Create searchable items with both filename and cleaned name
    const searchItems = playlist.map(filename => ({
        filename,
        cleanName: filename
            .replace('.mp3', '')
            .replace(/_/g, ' ')
            .replace(/-/g, ' - ')
    }));

    // Configure Fuse.js options
    const options = {
        keys: ['filename', 'cleanName'],
        includeScore: true,
        threshold: 0.4,
        minMatchCharLength: 2
    };

    // Initialize with empty array if no items
    fuseSearch = new Fuse(searchItems.length > 0 ? searchItems : [{ filename: '', cleanName: '' }], options);
}

function loadPlaylist() {
    // Create music directory if it doesn't exist
    if (!fs.existsSync(MUSIC_DIR)) {
        fs.mkdirSync(MUSIC_DIR);
    }

    playlist = fs.readdirSync(MUSIC_DIR)
        .filter(file => file.endsWith('.mp3'));
    
    // Initialize fuseSearch even with empty playlist
    initializeSearch();
}

function shufflePlaylist() {
    for (let i = playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
    }
}

async function startPlayback(initialConnection = null, message = null) {
    try {
        if (currentPlayer) {
            currentPlayer.removeAllListeners();
            if (!isSkipping) {
                currentPlayer.stop();
            }
            currentPlayer = null;
        }

        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play,
                maxMissedFrames: 1000
            }
        });
        currentPlayer = player;

        const connection = initialConnection || await setupVoiceConnection();

        // Get random song from playlist
        if (playlist.length === 0) {
            loadPlaylist();
            if (playlist.length === 0) {
                console.log('No MP3 files found in music directory');
                if (message) {
                    message.reply('No songs available. Please add some MP3 files first.');
                }
                return;
            }
        }
        const songPath = join(MUSIC_DIR, playlist[0]);
        playlist.push(playlist.shift()); // Move first song to end

        const resource = createAudioResource(songPath, {
            inlineVolume: true,
            inputType: 'mp3',
            silencePaddingFrames: 5,
            highWaterMark: 1024 * 1024 * 50
        });
        
        resource.volume?.setVolume(currentVolume);
        connection.subscribe(player);

        // Remove existing listeners before adding new ones
        connection.removeAllListeners(VoiceConnectionStatus.Disconnected);
        
        // Handle connection state changes
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                connection.destroy();
                isConnected = false;
                stopCurrentPlayback();
            }
        });

        // Remove any existing listeners before adding new ones
        player.removeAllListeners();

        player.on(AudioPlayerStatus.Playing, () => {
            console.log('Audio playback started');
        });

        player.on(AudioPlayerStatus.Idle, (oldState) => {
            if (oldState.status === AudioPlayerStatus.Playing && !isSkipping) {
                setTimeout(() => {
                    if (currentPlayer === player) {  // Check if this is still the current player
                        console.log('Song finished naturally, playing next song');
                        startPlayback(connection, message).catch(console.error);
                    }
                }, 1000);
            }
        });

        player.on('error', error => {
            console.error('Player error:', error);
            if (error.message !== 'Resource ended prematurely' && currentPlayer === player) {
                console.log('Attempting to recover from error');
                player.play(resource);
            }
        });

        player.play(resource);
        return true;
    } catch (error) {
        console.error('Playback error:', error);
        return false;
    }
}

function cleanup() {
    stopCurrentPlayback();
    const connection = getVoiceConnection(SERVER_ID);
    if (connection) {
        connection.destroy();
    }
    isConnected = false;
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
    loadPlaylist(); // Load the playlist on startup
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

// Define the commands
const commands = [
    new SlashCommandBuilder()
        .setName('connect')
        .setDescription('Connect bot to voice channel'),
    new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('Disconnect bot from voice channel'),
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip current song'),
    new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search for a song')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Search term')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song from search results')
        .addIntegerOption(option =>
            option.setName('number')
                .setDescription('Song number from search results')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(5)),
    new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set playback volume')
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('Volume level (0-100)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100))
];

// Register commands with Discord
const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, SERVER_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

// Update the event handler
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    try {
        switch (interaction.commandName) {
            case 'connect':
                if (isConnected) {
                    await interaction.reply('Already connected! Use /disconnect first if you want to reconnect.');
                    return;
                }
                try {
                    console.log('Attempting to connect...');
                    const connection = await setupVoiceConnection();
                    console.log('Connection established');
                    loadPlaylist();
                    await startPlayback(connection, interaction);
                    await interaction.reply('Connected and started playlist!');
                } catch (error) {
                    console.error('Connect error:', error);
                    await interaction.reply('Failed to connect to voice channel');
                    isConnected = false;
                }
                break;

            case 'disconnect':
                stopCurrentPlayback();
                const connection = getVoiceConnection(SERVER_ID);
                if (connection) {
                    connection.destroy();
                    isConnected = false;
                    await interaction.reply('Disconnected from voice channel!');
                } else {
                    await interaction.reply('Not currently connected to any voice channel!');
                }
                break;

            case 'skip':
                if (!isConnected || !currentPlayer) {
                    await interaction.reply('Nothing is currently playing!');
                    return;
                }
                try {
                    const connection = getVoiceConnection(SERVER_ID);
                    if (!connection) {
                        await interaction.reply('No active connection found!');
                        return;
                    }
                    isSkipping = true;
                    currentPlayer.stop();
                    await startPlayback(connection, interaction);
                    await interaction.reply('Skipped to next song!');
                } catch (error) {
                    console.error('Skip error:', error);
                    await interaction.reply('Failed to skip song');
                } finally {
                    isSkipping = false;
                }
                break;

            case 'search':
                const query = interaction.options.getString('query');
                if (playlist.length === 0) {
                    await interaction.reply('No songs available. Please add some MP3 files first.');
                    return;
                }
                
                const results = fuseSearch.search(query);
                
                if (results.length === 0) {
                    await interaction.reply('No matches found');
                    return;
                }

                lastSearchResults = results;

                const topResults = results.slice(0, 5).map((result, index) => 
                    `${index + 1}. ${result.item.cleanName} (Match: ${Math.round((1 - result.score) * 100)}%)`
                );

                await interaction.reply(`Top matches:\n${topResults.join('\n')}\n\nUse /play <number> to play a song`);
                break;

            case 'play':
                const number = interaction.options.getInteger('number');
                if (!lastSearchResults || lastSearchResults.length === 0) {
                    await interaction.reply('Please search for a song first using /search');
                    return;
                }
                if (number < 1 || number > lastSearchResults.length) {
                    await interaction.reply('Invalid song number');
                    return;
                }
                const selectedSong = lastSearchResults[number - 1].item.filename;
                const conn = getVoiceConnection(SERVER_ID) || await setupVoiceConnection();
                if (await playSpecificSong(selectedSong, conn)) {
                    await interaction.reply(`Playing: ${lastSearchResults[number - 1].item.cleanName}`);
                } else {
                    await interaction.reply('Failed to play the selected song');
                }
                break;

            case 'volume':
                const level = interaction.options.getInteger('level');
                currentVolume = level / 100;
                if (currentPlayer) {
                    currentPlayer.state.resource.volume.setVolume(currentVolume);
                }
                await interaction.reply(`Volume set to ${level}%`);
                break;
        }
    } catch (error) {
        console.error('Command error:', error);
        if (!interaction.replied) {
            await interaction.reply('An error occurred while processing the command');
        }
    }
});

async function playSpecificSong(songFilename, connection = null) {
    try {
        if (!connection) {
            connection = await setupVoiceConnection();
        }

        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play,
                maxMissedFrames: 1000
            }
        });
        currentPlayer = player;

        const songPath = join(MUSIC_DIR, songFilename);
        const resource = createAudioResource(songPath, {
            inlineVolume: true,
            inputType: 'mp3',
            silencePaddingFrames: 5,
            highWaterMark: 1024 * 1024 * 50
        });
        
        resource.volume?.setVolume(currentVolume);
        connection.subscribe(player);

        // Add the same event handlers as in startPlayback()
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                connection.destroy();
                startPlayback(connection).catch(console.error);
            }
        });

        player.on(AudioPlayerStatus.Playing, () => {
            console.log('Audio playback started');
        });

        player.on(AudioPlayerStatus.Idle, (oldState) => {
            if (oldState.status === AudioPlayerStatus.Playing && !isSkipping) {
                setTimeout(() => {
                    if (currentPlayer === player) {  // Check if this is still the current player
                        console.log('Song finished naturally, playing next song');
                        startPlayback(connection).catch(console.error);
                    }
                }, 1000);
            }
        });

        player.on('error', error => {
            console.error('Player error:', error);
            if (error.message !== 'Resource ended prematurely' && currentPlayer === player) {
                console.log('Attempting to recover from error');
                player.play(resource);
            }
        });

        player.play(resource);
        return true;

    } catch (error) {
        console.error('Playback error:', error);
        return false;
    }
} 