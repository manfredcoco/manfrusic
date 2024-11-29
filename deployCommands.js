const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
    new SlashCommandBuilder()
        .setName('connect')
        .setDescription('Connect bot to your voice channel'),
    
    new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('Disconnect bot from voice channel'),
    
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current song'),
    
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
                .setDescription('Song number from search results (1-5)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(5)),
    
    new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set the playback volume')
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('Volume level (0-100)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100))
];

const rest = new REST().setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error:', error);
    }
})(); 