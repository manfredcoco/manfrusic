const { spawn } = require('child_process');
const path = require('path');

// Start the Discord bot
const bot = spawn('node', ['playAudio.js'], {
    stdio: 'inherit',
    shell: true
});

// Start the Web UI
const webui = spawn('node', ['webui.js'], {
    stdio: 'inherit',
    shell: true
});

// Handle process termination
function cleanup() {
    bot.kill();
    webui.kill();
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Log any errors
bot.on('error', (error) => {
    console.error('Bot Error:', error);
});

webui.on('error', (error) => {
    console.error('WebUI Error:', error);
});

// Handle process exit
bot.on('exit', (code) => {
    if (code !== 0) {
        console.log(`Bot process exited with code ${code}`);
        cleanup();
    }
});

webui.on('exit', (code) => {
    if (code !== 0) {
        console.log(`WebUI process exited with code ${code}`);
        cleanup();
    }
}); 