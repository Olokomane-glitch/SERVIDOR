const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  Collection,
  REST,
  Routes,
  GatewayIntentBits,
  Events
} = require("discord.js");
const token = process.env.TOKEN;
const { initEmojiSystem } = require("./src/Functions/emojis/emojiLoader");
const { handlePainelButton } = require("./src/Functions/painel/buttons");
const { handlePainelSelect } = require("./src/Functions/painel/selects");
const { handlePainelModal } = require("./src/Functions/painel/modals");
const { startAutoDispatcher } = require("./src/Functions/media/autoDispatcher");
const { forwardSourceMessage, startSourceRelayPolling } = require("./src/Functions/media/sourceRelay");
const { startMainChannelRotator, rotateMainChannels } = require("./src/Functions/media/mainChannelRotator");
const { resetSentMediaHistory } = require("./src/Functions/painel/store");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, "src", "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if (!command?.data || !command?.execute) {
    console.warn(`[AVISO] Comando inválido ignorado: ${file}`);
    continue;
  }

  client.commands.set(command.data.name, command);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ANSI = {
  reset: "\x1b[0m",
  magenta: "\x1b[35m",
  dim: "\x1b[2m"
};

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

function centerLine(line, width) {
  const visibleLength = stripAnsi(line).length;
  const pad = Math.max(0, Math.floor((width - visibleLength) / 2));
  return `${" ".repeat(pad)}${line}`;
}

function makeTag(label, color) {
  return `${color}[${label}]${ANSI.reset}`;
}

function printCenteredLine(text) {
  const width = process.stdout.columns || 120;
  console.log(centerLine(text, width));
}

async function registerGuildCommands() {
  const required = ["DISCORD_TOKEN", "CLIENT_ID"];
  for (const key of required) {
    if (!config[key]) {
      throw new Error(`${key} n?o definido em config.json`);
    }
  }

  const commands = [];
  for (const command of client.commands.values()) {
    commands.push(command.data.toJSON());
  }

  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  const guildIds = [...new Set(client.guilds.cache.map((guild) => guild.id))];

  if (!guildIds.length) {
    throw new Error("Nenhum servidor encontrado para registrar comandos.");
  }

  let registeredCount = 0;
  for (const guildId of guildIds) {
    await rest.put(Routes.applicationGuildCommands(config.CLIENT_ID, guildId), { body: commands });
    registeredCount += 1;
  }

  console.log(`[COMANDOS] ${commands.length} comando(s) registrado(s) em ${registeredCount} servidor(es).`);
}

async function handleReadyEvent({ client, readyClient }) {
  console.clear();

  await sleep(1200);

  try {
    await initEmojiSystem(client);
  } catch (error) {
    console.error("Falha ao sincronizar emojis da aplicação:", error);
  }

  try {
    await registerGuildCommands();
  } catch (error) {
    console.error("Falha ao registrar comandos:", error);
  }

  try {
    resetSentMediaHistory();
  } catch (error) {
    console.error("Falha ao limpar o hist?rico de m?dias na inicializa??o:", error);
  }

  try {
    await rotateMainChannels(client);
  } catch (error) {
    console.error("Falha ao recriar os canais principais na inicialização:", error);
  }

  try {
    startMainChannelRotator(client);
  } catch (error) {
    console.error("Falha ao iniciar a rotação automática dos canais:", error);
  }
  try {
    startAutoDispatcher(client);
  } catch (error) {
    console.error("Falha ao iniciar o dispatcher de mídia:", error);
  }

  try {
    startSourceRelayPolling(client);
  } catch (error) {
    console.error("Falha ao iniciar o relay de mídias:", error);
  }

  const totalMembers = client.guilds.cache.reduce(
    (sum, guild) => sum + (guild.memberCount || 0),
    0
  );

  console.log("");
  printCenteredLine(`${makeTag("Online", ANSI.magenta)} ${readyClient.user.tag}`);
  printCenteredLine(`Estou em ${client.guilds.cache.size} servidores`);
  printCenteredLine(`Total de membros visíveis: ${totalMembers}`);
  console.log("");
  printCenteredLine(`${ANSI.dim}Criador${ANSI.reset}`);
  printCenteredLine("alvinsz");
  console.log("");
  printCenteredLine("");
}

client.once(Events.ClientReady, async (readyClient) => {
  await handleReadyEvent({ client, readyClient });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      const handled = await handlePainelButton(interaction);
      if (handled) return;
    }

    if (interaction.isChannelSelectMenu() || interaction.isStringSelectMenu()) {
      const handled = await handlePainelSelect(interaction);
      if (handled) return;
    }

    if (interaction.isModalSubmit()) {
      const handled = await handlePainelModal(interaction);
      if (handled) return;
    }
  } catch (error) {
    console.error("Erro ao processar interação do painel:", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Erro ao processar painel.", ephemeral: true });
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Erro ao executar /${interaction.commandName}:`, error);

    const payload = {
      content: "Ocorreu um erro ao executar este comando.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await forwardSourceMessage(message);
  } catch (error) {
    console.error("Erro ao repassar mídia do servidor de origem:", error);
  }
});

if (!config.DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN não definido em config.json");
}

client.login(config.DISCORD_TOKEN);


















