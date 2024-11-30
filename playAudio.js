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
const { searchYoutube, downloadYoutubeAudio } = require('./youtubeHandler');
const mm = require('music-metadata');
const path = require('path');
const { StreamType } = require('@discordjs/voice');

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
let youtubeSearchResults = [];
let isConnected = false; // Track connection state
let isSkipping = false;
let currentNowPlayingMessage = null;
let currentSongStartTime = null;
let updateInterval = null;

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
    try {
        // Check for existing connection first
        const existingConnection = getVoiceConnection(SERVER_ID);
        if (existingConnection && existingConnection.state.status !== VoiceConnectionStatus.Destroyed) {
            return existingConnection;
        }

        const connection = joinVoiceChannel({
            channelId: VOICE_CHANNEL_ID,
            guildId: SERVER_ID,
            adapterCreator: client.guilds.cache.get(SERVER_ID).voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
        isConnected = true;
        return connection;
    } catch (error) {
        console.error('Voice connection error:', error);
        isConnected = false;
        return null;
    }
}

function loadPlaylist() {
    try {
        if (!fs.existsSync(MUSIC_DIR)) {
            fs.mkdirSync(MUSIC_DIR, { recursive: true });
        }
        
        const files = fs.readdirSync(MUSIC_DIR);
        playlist = files.filter(file => file.endsWith('.mp3'));
        console.log('Loaded playlist:', playlist);
        
        // Initialize search when playlist is loaded
        initializeSearch();
        return playlist.length > 0;
    } catch (error) {
        console.error('Error loading playlist:', error);
        return false;
    }
}

function initializeSearch() {
    const searchItems = playlist.map(filename => ({
        filename,
        cleanName: filename.replace('.mp3', '').replace(/_/g, ' ')
    }));
    
    const options = {
        keys: ['cleanName'],
        threshold: 0.4
    };
    
    fuseSearch = new Fuse(searchItems, options);
    console.log('Search initialized with', searchItems.length, 'items');
}

function shufflePlaylist() {
    for (let i = playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
    }
}

async function startPlayback(connection = null) {
    try {
        if (!connection) {
            connection = await setupVoiceConnection();
        }

        if (playlist.length === 0) {
            loadPlaylist();
            if (playlist.length === 0) {
                console.log('No MP3 files found in music directory');
                return false;
            }
        }

        // Pick a random song
        const randomIndex = Math.floor(Math.random() * playlist.length);
        const songFilename = playlist[randomIndex];
        console.log('Starting playback with:', songFilename);

        return await playSpecificSong(songFilename, connection);
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
                .setMaxValue(100)),
    new SlashCommandBuilder()
        .setName('ytsearch')
        .setDescription('Search for YouTube videos')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Search term')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('ytplay')
        .setDescription('Play a video from YouTube search results')
        .addIntegerOption(option =>
            option.setName('number')
                .setDescription('Video number from search results (1-10)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(10))
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
    if (interaction.channelId !== process.env.MUSIC_CHANNEL_ID) return;

    try {
        switch (interaction.commandName) {
            case 'connect':
                if (isConnected) {
                    await interaction.reply({ 
                        content: 'Already connected! Use /disconnect first if you want to reconnect.',
                        ephemeral: true 
                    });
                    return;
                }

                try {
                    console.log('Attempting to connect...');
                    const voiceConnection = await setupVoiceConnection();
                    console.log('Connection established');
                    loadPlaylist();
                    
                    if (playlist.length === 0) {
                        await interaction.reply({ 
                            content: 'No songs available. Please add some MP3 files first.',
                            ephemeral: true 
                        });
                        return;
                    }

                    const success = await startPlayback(voiceConnection);
                    if (success) {
                        await interaction.reply({ 
                            content: 'Connected and started playlist!',
                            ephemeral: true 
                        });
                    } else {
                        await interaction.reply({ 
                            content: 'Connected but failed to start playback.',
                            ephemeral: true 
                        });
                    }
                } catch (error) {
                    console.error('Connect error:', error);
                    await interaction.reply({ 
                        content: 'Failed to connect to voice channel',
                        ephemeral: true 
                    });
                    isConnected = false;
                }
                break;

            case 'disconnect':
                stopCurrentPlayback();
                const existingConnection = getVoiceConnection(SERVER_ID);
                if (existingConnection) {
                    existingConnection.destroy();
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
                const searchQuery = interaction.options.getString('query');
                if (playlist.length === 0) {
                    await interaction.reply('No songs available. Please add some MP3 files first.');
                    return;
                }
                
                const searchResults = fuseSearch.search(searchQuery);
                lastSearchResults = searchResults;
                
                if (searchResults.length === 0) {
                    await interaction.reply('No matches found');
                    return;
                }

                const topResults = searchResults.slice(0, 5).map((result, index) => 
                    `${index + 1}. ${result.item.cleanName}`
                ).join('\n');

                await interaction.reply(`Top matches:\n${topResults}\n\nUse /play <number> to play a song`);
                break;

            case 'play':
                const playNumber = interaction.options.getInteger('number');
                if (!lastSearchResults || lastSearchResults.length === 0) {
                    await interaction.reply('Please search for a song first using /search');
                    return;
                }
                if (playNumber < 1 || playNumber > lastSearchResults.length) {
                    await interaction.reply('Invalid song number');
                    return;
                }
                const selectedSong = lastSearchResults[playNumber - 1].item.filename;
                const conn = getVoiceConnection(SERVER_ID) || await setupVoiceConnection();
                if (await playSpecificSong(selectedSong, conn)) {
                    await interaction.reply(`Playing: ${lastSearchResults[playNumber - 1].item.cleanName}`);
                } else {
                    await interaction.reply('Failed to play the selected song');
                }
                break;

            case 'volume':
                const volumeLevel = interaction.options.getInteger('level');
                currentVolume = volumeLevel / 100;
                if (currentPlayer) {
                    currentPlayer.state.resource.volume.setVolume(currentVolume);
                }
                await interaction.reply(`Volume set to ${volumeLevel}%`);
                break;

            case 'ytsearch':
                const ytQuery = interaction.options.getString('query');
                await interaction.deferReply();
                
                try {
                    const ytResults = await searchYoutube(ytQuery);
                    youtubeSearchResults = ytResults;
                    
                    const ytResultList = ytResults.map((video, index) => 
                        `${index + 1}. ${video.title}\n` +
                        `   Duration: ${video.duration} | Channel: ${video.author}\n`
                    ).join('\n');
                    
                    await interaction.editReply(
                        `**YouTube Search Results:**\n\n${ytResultList}\n` +
                        `Use /ytplay <number> to play a video`
                    );
                } catch (error) {
                    console.error('Search error:', error);
                    await interaction.editReply('Failed to search YouTube');
                }
                break;

            case 'ytplay':
                const ytNumber = interaction.options.getInteger('number');
                await interaction.deferReply();
                
                if (!youtubeSearchResults || youtubeSearchResults.length === 0) {
                    await interaction.editReply('Please search for videos first using /ytsearch');
                    return;
                }

                if (ytNumber < 1 || ytNumber > youtubeSearchResults.length) {
                    await interaction.editReply('Invalid video number');
                    return;
                }

                try {
                    const selectedVideo = youtubeSearchResults[ytNumber - 1];
                    console.log('Selected video:', selectedVideo);

                    const ytConn = await setupVoiceConnection();
                    if (!ytConn) {
                        await interaction.editReply('Failed to connect to voice channel');
                        return;
                    }
                    console.log('Voice connection established');

                    await interaction.editReply(`Downloading: ${selectedVideo.title}\nPlease wait...`);

                    const filename = sanitizeFilename(selectedVideo.title);
                    console.log('Sanitized filename:', filename);

                    const outputPath = await downloadYoutubeAudio(selectedVideo.url, filename);
                    // Reload playlist after download
                    loadPlaylist();
                    // Initialize search after updating playlist
                    initializeSearch();
                    
                    const success = await playSpecificSong(`${filename}.mp3`, ytConn);
                    
                    if (success) {
                        await interaction.editReply(`Now playing: ${selectedVideo.title}`);
                    } else {
                        await interaction.editReply('Failed to play the audio');
                    }

                } catch (error) {
                    console.error('Download/playback error:', error);
                    await interaction.editReply('Failed to download or play the video');
                }
                break;
        }
    } catch (error) {
        console.error('Command error:', error);
        try {
            if (!interaction.deferred) {
                await interaction.reply({ 
                    content: 'An error occurred while processing the command',
                    ephemeral: true 
                });
            } else if (!interaction.replied) {
                await interaction.editReply('An error occurred while processing the command');
            }
        } catch (replyError) {
            console.error('Error while handling error:', replyError);
        }
    }
});

async function playSpecificSong(songFilename, connection = null) {
    try {
        if (!connection && !getVoiceConnection(SERVER_ID)) {
            connection = await setupVoiceConnection();
        } else if (!connection) {
            connection = getVoiceConnection(SERVER_ID);
        }

        if (currentPlayer) {
            currentPlayer.removeAllListeners();
            currentPlayer.stop();
        }

        // Get song info including metadata
        const songPath = path.join(MUSIC_DIR, songFilename);
        const songInfo = await getSongInfo(songPath);
        
        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play,
                maxMissedFrames: 1000
            }
        });
        currentPlayer = player;

        const resource = createAudioResource(songPath, {
            inlineVolume: true,
            inputType: StreamType.Arbitrary
        });
        
        resource.volume?.setVolume(currentVolume);
        connection.subscribe(player);

        // Clear existing interval if any
        if (updateInterval) {
            clearInterval(updateInterval);
        }

        // Create or update now playing message
        currentSongStartTime = Date.now();
        const nowPlayingData = {
            ...songInfo,
            currentTime: 0,
            isPaused: false
        };

        if (currentNowPlayingMessage) {
            await currentNowPlayingMessage.delete().catch(console.error);
        }

        currentNowPlayingMessage = await updateNowPlayingEmbed(nowPlayingData);

        // Set up progress bar update interval
        updateInterval = setInterval(async () => {
            if (!currentPlayer || currentPlayer.state.status === AudioPlayerStatus.Idle) {
                clearInterval(updateInterval);
                return;
            }

            const elapsed = (Date.now() - currentSongStartTime) / 1000;
            nowPlayingData.currentTime = elapsed;
            await updateNowPlayingEmbed(nowPlayingData, currentNowPlayingMessage);
        }, 5000); // Update every 5 seconds

        // Set up reaction collector
        const collector = currentNowPlayingMessage.createReactionCollector({
            filter: (reaction, user) => {
                return ['⏯️', '⏭️'].includes(reaction.emoji.name) && !user.bot;
            },
            time: songInfo.duration * 1000 // Convert to milliseconds
        });

        collector.on('collect', async (reaction, user) => {
            // Remove user's reaction
            reaction.users.remove(user);

            if (reaction.emoji.name === '⏯️') {
                if (player.state.status === AudioPlayerStatus.Playing) {
                    player.pause();
                    nowPlayingData.isPaused = true;
                } else if (player.state.status === AudioPlayerStatus.Paused) {
                    player.unpause();
                    nowPlayingData.isPaused = false;
                }
                await updateNowPlayingEmbed(nowPlayingData, currentNowPlayingMessage);
            } else if (reaction.emoji.name === '⏭️') {
                isSkipping = true;
                player.stop();
                startPlayback(connection).catch(console.error);
            }
        });

        player.on(AudioPlayerStatus.Playing, () => {
            console.log('Audio playback started');
        });

        player.on(AudioPlayerStatus.Idle, async (oldState) => {
            if (oldState.status === AudioPlayerStatus.Playing && !isSkipping) {
                setTimeout(() => {
                    if (currentPlayer === player) {
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

function sanitizeFilename(filename) {
    return filename
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()
        .substring(0, 200);
} 

async function getSongInfo(filePath) {
    try {
        const metadata = await mm.parseFile(filePath);
        if (metadata.common.title) {
            return {
                title: metadata.common.title,
                artist: metadata.common.artist || 'Unknown Artist',
                duration: metadata.format.duration || 0
            };
        }
    } catch (error) {
        console.error('Metadata parsing error:', error);
    }

    // Fallback to filename if no metadata
    const filename = path.basename(filePath, '.mp3')
        .replace(/_/g, ' ')
        .replace(/-/g, ' - ');
    
    return {
        title: filename,
        artist: 'Unknown Artist',
        duration: 0
    };
} 

client.on('messageCreate', async message => {
    if (message.channelId !== process.env.MUSIC_CHANNEL_ID) return;
    
    if (!message.content.startsWith('/')) {
        await message.delete().catch(console.error);
        return;
    }
});

function createProgressBar(current, total, isPaused = false) {
    const length = 15;
    const progress = Math.floor((current / total) * length);
    const emptyChar = '─';
    const fillChar = '━';
    const pointer = isPaused ? '⏸' : '🔘';
    
    const bar = fillChar.repeat(progress) + 
                pointer + 
                emptyChar.repeat(length - progress - 1);
                
    return `\`${formatTime(current)} ${bar} ${formatTime(total)}\``;
}

async function updateNowPlayingEmbed(songInfo, message = null) {
    const embed = {
        color: 0x3498db,
        author: {
            name: '🎵 Now Playing'
        },
        title: songInfo.title,
        description: `by ${songInfo.artist}`,
        fields: [
            {
                name: '\u200b',
                value: createProgressBar(
                    songInfo.currentTime, 
                    songInfo.duration,
                    songInfo.isPaused
                )
            }
        ],
        footer: {
            text: songInfo.isPaused ? '⏸ Paused' : '▶ Playing'
        },
        timestamp: new Date()
    };

    if (message) {
        return await message.edit({ embeds: [embed] });
    } else {
        const channel = client.channels.cache.get(process.env.MUSIC_CHANNEL_ID);
        const msg = await channel.send({ embeds: [embed] });
        await msg.react('⏯️');
        await msg.react('️');
        return msg;
    }
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}