const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const SERVER_ID = '904546782426570792';

async function checkPermissions() {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds]
    });

    try {
        await client.login(BOT_TOKEN);
        
        const guild = await client.guilds.fetch(SERVER_ID);
        if (!guild) {
            console.log('Bot is not in that server or server ID is invalid.');
            return;
        }

        const botMember = await guild.members.fetch(client.user.id);
        const permissions = botMember.permissions;
        
        console.log(`\nBot Permissions for ${client.user.tag} in ${guild.name}:`);
        console.log('----------------------------------------');
        
        const permissionsList = new PermissionsBitField(permissions.bitfield)
            .toArray();
            
        permissionsList.forEach(perm => {
            console.log(`• ${perm}`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        client.destroy();
    }
}

checkPermissions();