const { Client, GatewayIntentBits, PermissionsBitField, OAuth2Scopes } = require('discord.js');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

async function generateInviteLink() {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds]
    });

    try {
        await client.login(BOT_TOKEN);
        
        const invite = client.generateInvite({
            scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
            permissions: [
                PermissionsBitField.Flags.Administrator,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak,
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.UseApplicationCommands
            ]
        });

        console.log('\nInvite Link:');
        console.log('----------------------------------------');
        console.log(invite);
        console.log('----------------------------------------');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        client.destroy();
    }
}

generateInviteLink();