#!/usr/bin/env node

/**
 * Redis Cache Monitoring Tool
 * 
 * Professional CLI tool for developers to monitor, debug, and manage
 * Redis cache in the Global-Fi Ultra application.
 * 
 * Features:
 * - Real-time cache monitoring with auto-refresh
 * - Pattern-based filtering and search
 * - Export cache data to JSON
 * - Clear cache with safety confirmations
 * - Color-coded status indicators
 * - Interactive menu system
 * - Circuit breaker state monitoring
 * 
 * @module tools/redisMonitor
 */

import Redis from 'ioredis';
import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import ora from 'ora';
import { Command } from 'commander';
import fs from 'fs/promises';

// Configuration
const CONFIG = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined
  },
  refresh: {
    intervalMs: 2000, // 2 seconds
    watchMode: true
  },
  colors: {
    active: 'green',      // TTL > 30s
    expiring: 'yellow',   // TTL 10-30s
    critical: 'red',      // TTL < 10s
    persistent: 'white'   // No TTL
  },
  thresholds: {
    activeSeconds: 30,
    expiringSeconds: 10
  }
};

/**
 * Redis Monitor Class
 */
class RedisMonitor {
  constructor() {
    this.redis = null;
    this.watchInterval = null;
    this.isConnected = false;
  }

  /**
   * Connect to Redis with retry logic
   */
  async connect() {
    const spinner = ora('Connecting to Redis...').start();

    try {
      const redisUrl = process.env.REDIS_URL;
      const retryStrategy = (times) => {
        if (times > 3) {
          spinner.fail('Failed to connect to Redis after 3 attempts');
          return null;
        }
        return Math.min(times * 1000, 3000);
      };

      if (redisUrl && redisUrl.startsWith('redis')) {
        const options = { retryStrategy };
        if (redisUrl.startsWith('rediss://')) {
          options.tls = { rejectUnauthorized: false };
        }
        this.redis = new Redis(redisUrl, options);
      } else {
        this.redis = new Redis({
          host: CONFIG.redis.host,
          port: CONFIG.redis.port,
          password: CONFIG.redis.password,
          retryStrategy
        });
      }

      await this.redis.ping();
      this.isConnected = true;
      spinner.succeed(`Connected to Redis`);
    } catch (error) {
      spinner.fail(`Redis connection failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get Redis statistics
   */
  async getStatistics() {
    const info = await this.redis.info();
    const lines = info.split('\r\n');
    const stats = {};

    lines.forEach(line => {
      const [key, value] = line.split(':');
      if (key && value) {
        stats[key] = value;
      }
    });

    const keyCount = await this.redis.dbsize();
    const memoryInfo = await this.redis.info('memory');
    const memoryLines = memoryInfo.split('\r\n');
    let usedMemory = 0;

    memoryLines.forEach(line => {
      if (line.startsWith('used_memory_human:')) {
        usedMemory = line.split(':')[1];
      }
    });

    return {
      totalKeys: keyCount,
      memoryUsed: usedMemory || 'N/A',
      uptime: this._formatUptime(parseInt(stats.uptime_in_seconds || 0)),
      connectedClients: stats.connected_clients || 0,
      opsPerSec: stats.instantaneous_ops_per_sec || 0,
      evictedKeys: stats.evicted_keys || 0,
      hitRate: this._calculateHitRate(stats)
    };
  }

  /**
   * Calculate cache hit rate
   */
  _calculateHitRate(stats) {
    const hits = parseInt(stats.keyspace_hits || 0);
    const misses = parseInt(stats.keyspace_misses || 0);
    const total = hits + misses;

    if (total === 0) return '0.0%';

    const rate = (hits / total) * 100;
    return `${rate.toFixed(1)}%`;
  }

  /**
   * Format uptime in human-readable format
   */
  _formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  /**
   * List all keys matching pattern
   */
  async listKeys(pattern = '*', sortBy = 'ttl') {
    const keys = [];
    const stream = this.redis.scanStream({
      match: pattern,
      count: 100
    });

    for await (const batch of stream) {
      for (const key of batch) {
        const [type, ttl, size] = await Promise.all([
          this.redis.type(key),
          this.redis.ttl(key),
          this._getKeySize(key)
        ]);

        keys.push({
          key,
          type,
          ttl,
          size,
          status: this._getKeyStatus(ttl)
        });
      }
    }

    // Sort keys
    return this._sortKeys(keys, sortBy);
  }

  /**
   * Get key size in bytes
   */
  async _getKeySize(key) {
    const type = await this.redis.type(key);
    let size = 0;

    try {
      switch (type) {
        case 'string': {
          const value = await this.redis.get(key);
          size = Buffer.byteLength(value || '', 'utf8');
          break;
        }
        case 'hash': {
          const hash = await this.redis.hgetall(key);
          size = Buffer.byteLength(JSON.stringify(hash), 'utf8');
          break;
        }
        case 'list': {
          const list = await this.redis.lrange(key, 0, -1);
          size = Buffer.byteLength(JSON.stringify(list), 'utf8');
          break;
        }
        case 'set': {
          const set = await this.redis.smembers(key);
          size = Buffer.byteLength(JSON.stringify(set), 'utf8');
          break;
        }
        case 'zset': {
          const zset = await this.redis.zrange(key, 0, -1, 'WITHSCORES');
          size = Buffer.byteLength(JSON.stringify(zset), 'utf8');
          break;
        }
      }
    } catch (error) {
      // Key might have expired during operation
      size = 0;
    }

    return size;
  }

  /**
   * Format size in human-readable format
   */
  _formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  /**
   * Get key status based on TTL
   */
  _getKeyStatus(ttl) {
    if (ttl === -1) return { label: 'Persistent', color: CONFIG.colors.persistent, icon: '⚪' };
    if (ttl > CONFIG.thresholds.activeSeconds) return { label: 'Active', color: CONFIG.colors.active, icon: '🟢' };
    if (ttl > CONFIG.thresholds.expiringSeconds) return { label: 'Expiring', color: CONFIG.colors.expiring, icon: '🟡' };
    return { label: 'Critical', color: CONFIG.colors.critical, icon: '🔴' };
  }

  /**
   * Sort keys by specified field
   */
  _sortKeys(keys, sortBy) {
    switch (sortBy) {
      case 'ttl':
        return keys.sort((a, b) => {
          if (a.ttl === -1) return 1;
          if (b.ttl === -1) return -1;
          return b.ttl - a.ttl;
        });
      case 'size':
        return keys.sort((a, b) => b.size - a.size);
      case 'name':
        return keys.sort((a, b) => a.key.localeCompare(b.key));
      default:
        return keys;
    }
  }

  /**
   * View key details
   */
  async viewKey(keyName) {
    const exists = await this.redis.exists(keyName);
    if (!exists) {
      console.log(chalk.red(`\n❌ Key "${keyName}" does not exist\n`));
      return;
    }

    const [type, ttl, size] = await Promise.all([
      this.redis.type(keyName),
      this.redis.ttl(keyName),
      this._getKeySize(keyName)
    ]);

    let value;
    try {
      switch (type) {
        case 'string':
          value = await this.redis.get(keyName);
          try {
            value = JSON.parse(value);
          } catch {
            // Not JSON, keep as string
          }
          break;
        case 'hash':
          value = await this.redis.hgetall(keyName);
          break;
        case 'list':
          value = await this.redis.lrange(keyName, 0, -1);
          break;
        case 'set':
          value = await this.redis.smembers(keyName);
          break;
        case 'zset':
          value = await this.redis.zrange(keyName, 0, -1, 'WITHSCORES');
          break;
      }
    } catch (error) {
      value = `Error reading value: ${error.message}`;
    }

    console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════'));
    console.log(chalk.cyan.bold(`  KEY DETAILS: ${keyName}`));
    console.log(chalk.cyan('═══════════════════════════════════════════════════════════\n'));

    console.log(chalk.white(`Type:       ${type}`));
    console.log(chalk.white(`TTL:        ${ttl === -1 ? 'Persistent' : `${ttl}s`}`));
    console.log(chalk.white(`Size:       ${this._formatSize(size)}`));
    console.log(chalk.white(`Status:     ${this._getKeyStatus(ttl).icon} ${this._getKeyStatus(ttl).label}\n`));

    console.log(chalk.yellow('Value:'));
    console.log(chalk.white(JSON.stringify(value, null, 2)));
    console.log();
  }

  /**
   * Export data to JSON file
   */
  async exportData(filename, pattern = '*') {
    const spinner = ora('Exporting cache data...').start();

    try {
      const keys = await this.listKeys(pattern);
      const data = [];

      for (const keyInfo of keys) {
        const type = await this.redis.type(keyInfo.key);
        let value;

        switch (type) {
          case 'string':
            value = await this.redis.get(keyInfo.key);
            try {
              value = JSON.parse(value);
            } catch {
              // Keep as string
            }
            break;
          case 'hash':
            value = await this.redis.hgetall(keyInfo.key);
            break;
          case 'list':
            value = await this.redis.lrange(keyInfo.key, 0, -1);
            break;
          case 'set':
            value = await this.redis.smembers(keyInfo.key);
            break;
          case 'zset':
            value = await this.redis.zrange(keyInfo.key, 0, -1, 'WITHSCORES');
            break;
        }

        data.push({
          key: keyInfo.key,
          type: keyInfo.type,
          ttl: keyInfo.ttl,
          size: keyInfo.size,
          value
        });
      }

      await fs.writeFile(filename, JSON.stringify(data, null, 2));
      spinner.succeed(`Exported ${data.length} keys to ${filename}`);
    } catch (error) {
      spinner.fail(`Export failed: ${error.message}`);
    }
  }

  /**
   * Clear keys by pattern
   */
  async clearKeys(pattern) {
    const keys = await this.listKeys(pattern);

    if (keys.length === 0) {
      console.log(chalk.yellow(`\n⚠️  No keys match pattern: ${pattern}\n`));
      return;
    }

    console.log(chalk.yellow(`\n⚠️  Found ${keys.length} keys matching pattern: ${pattern}\n`));

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete ${keys.length} keys?`,
        default: false
      }
    ]);

    if (!confirm) {
      console.log(chalk.gray('\nOperation cancelled\n'));
      return;
    }

    const spinner = ora('Deleting keys...').start();

    try {
      const keyNames = keys.map(k => k.key);
      if (keyNames.length > 0) {
        await this.redis.del(...keyNames);
      }
      spinner.succeed(`Deleted ${keyNames.length} keys`);
    } catch (error) {
      spinner.fail(`Delete failed: ${error.message}`);
    }
  }

  /**
   * Display dashboard
   */
  async displayDashboard(pattern = '*', sortBy = 'ttl') {
    console.clear();

    // Header
    console.log(chalk.cyan('╔═══════════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan('║') + chalk.cyan.bold('           REDIS CACHE MONITOR v1.0                        ') + chalk.cyan('║'));
    console.log(chalk.cyan('║') + chalk.gray('           Global-Fi Ultra - Development Tool              ') + chalk.cyan('║'));
    console.log(chalk.cyan('╚═══════════════════════════════════════════════════════════╝\n'));

    // Statistics
    const stats = await this.getStatistics();

    console.log(chalk.yellow.bold('📊 Cache Statistics'));
    console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    const statsTable = new Table({
      chars: { 'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' },
      style: { 'padding-left': 0, 'padding-right': 2 }
    });

    statsTable.push(
      [
        chalk.white('Total Keys:'), chalk.cyan(stats.totalKeys),
        chalk.white('Memory Used:'), chalk.cyan(stats.memoryUsed),
        chalk.white('Uptime:'), chalk.cyan(stats.uptime)
      ],
      [
        chalk.white('Hit Rate:'), chalk.cyan(stats.hitRate),
        chalk.white('Evictions:'), chalk.cyan(stats.evictedKeys),
        chalk.white('Ops/sec:'), chalk.cyan(stats.opsPerSec)
      ]
    );

    console.log(statsTable.toString());
    console.log();

    // Keys table
    const keys = await this.listKeys(pattern, sortBy);

    console.log(chalk.yellow.bold(`🔑 Active Cache Keys (Pattern: ${pattern}, Sort: ${sortBy})`));
    console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    if (keys.length === 0) {
      console.log(chalk.gray('  No keys found\n'));
    } else {
      const keysTable = new Table({
        head: [
          chalk.white.bold('Key'),
          chalk.white.bold('Type'),
          chalk.white.bold('TTL'),
          chalk.white.bold('Size'),
          chalk.white.bold('Status')
        ],
        colWidths: [40, 10, 10, 10, 15]
      });

      keys.slice(0, 20).forEach(keyInfo => {
        const status = keyInfo.status;
        const ttlDisplay = keyInfo.ttl === -1 ? 'N/A' : `${keyInfo.ttl}s`;

        keysTable.push([
          keyInfo.key.length > 38 ? keyInfo.key.substring(0, 35) + '...' : keyInfo.key,
          keyInfo.type,
          ttlDisplay,
          this._formatSize(keyInfo.size),
          chalk[status.color](`${status.icon} ${status.label}`)
        ]);
      });

      console.log(keysTable.toString());

      if (keys.length > 20) {
        console.log(chalk.gray(`\n  ... and ${keys.length - 20} more keys\n`));
      } else {
        console.log();
      }
    }

    // Commands menu
    console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.white.bold('Commands:'));
    console.log(chalk.gray('[R] Refresh       [F] Filter by pattern    [V] View key details'));
    console.log(chalk.gray('[E] Export JSON   [C] Clear by pattern     [S] Sort keys'));
    console.log(chalk.gray('[H] Health check  [Q] Quit'));
    console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  }

  /**
   * Start interactive mode
   */
  async startInteractive() {
    let pattern = '*';
    let sortBy = 'ttl';
    let running = true;

    while (running) {
      await this.displayDashboard(pattern, sortBy);

      const { command } = await inquirer.prompt([
        {
          type: 'input',
          name: 'command',
          message: 'Enter command:',
          prefix: '>'
        }
      ]);

      const cmd = command.toLowerCase().trim();

      switch (cmd) {
        case 'r':
        case 'refresh':
          // Just loop to refresh
          break;

        case 'f':
        case 'filter': {
          const { newPattern } = await inquirer.prompt([
            {
              type: 'input',
              name: 'newPattern',
              message: 'Enter pattern (e.g., cache:stocks:*):',
              default: '*'
            }
          ]);
          pattern = newPattern;
          break;
        }

        case 'v':
        case 'view': {
          const { keyName } = await inquirer.prompt([
            {
              type: 'input',
              name: 'keyName',
              message: 'Enter key name:'
            }
          ]);
          if (keyName) {
            await this.viewKey(keyName);
            await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to continue...' }]);
          }
          break;
        }

        case 'e':
        case 'export': {
          const { exportFile, exportPattern } = await inquirer.prompt([
            {
              type: 'input',
              name: 'exportFile',
              message: 'Export filename:',
              default: './cache-export.json'
            },
            {
              type: 'input',
              name: 'exportPattern',
              message: 'Pattern to export:',
              default: pattern
            }
          ]);
          await this.exportData(exportFile, exportPattern);
          await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to continue...' }]);
          break;
        }

        case 'c':
        case 'clear': {
          const { clearPattern } = await inquirer.prompt([
            {
              type: 'input',
              name: 'clearPattern',
              message: 'Pattern to clear:',
              default: pattern
            }
          ]);
          await this.clearKeys(clearPattern);
          await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to continue...' }]);
          break;
        }

        case 's':
        case 'sort': {
          const { sortOption } = await inquirer.prompt([
            {
              type: 'list',
              name: 'sortOption',
              message: 'Sort by:',
              choices: ['ttl', 'size', 'name']
            }
          ]);
          sortBy = sortOption;
          break;
        }

        case 'h':
        case 'health':
          await this.healthCheck();
          await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to continue...' }]);
          break;

        case 'q':
        case 'quit':
        case 'exit':
          running = false;
          console.log(chalk.green('\n✅ Goodbye!\n'));
          break;

        default:
          console.log(chalk.red(`\n❌ Unknown command: ${cmd}\n`));
          await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to continue...' }]);
      }
    }
  }

  /**
   * Start watch mode
   */
  async startWatch(pattern = '*') {
    console.log(chalk.cyan(`\n🔄 Watch mode started (refreshing every ${CONFIG.refresh.intervalMs / 1000}s)\n`));
    console.log(chalk.gray('Press Ctrl+C to exit\n'));

    const refresh = async () => {
      await this.displayDashboard(pattern);
    };

    await refresh();
    this.watchInterval = setInterval(refresh, CONFIG.refresh.intervalMs);
  }

  /**
   * Health check
   */
  async healthCheck() {
    console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════'));
    console.log(chalk.cyan.bold('  REDIS HEALTH CHECK'));
    console.log(chalk.cyan('═══════════════════════════════════════════════════════════\n'));

    const checks = [];

    // Ping test
    try {
      const start = Date.now();
      await this.redis.ping();
      const latency = Date.now() - start;
      checks.push({
        name: 'Ping',
        status: '✅ OK',
        details: `${latency}ms`
      });
    } catch (error) {
      checks.push({
        name: 'Ping',
        status: '❌ FAIL',
        details: error.message
      });
    }

    // Memory check
    try {
      const info = await this.redis.info('memory');
      const lines = info.split('\r\n');
      let maxMemory = 'unlimited';
      let usedMemory = 'N/A';

      lines.forEach(line => {
        if (line.startsWith('maxmemory_human:')) {
          maxMemory = line.split(':')[1];
        }
        if (line.startsWith('used_memory_human:')) {
          usedMemory = line.split(':')[1];
        }
      });

      checks.push({
        name: 'Memory',
        status: '✅ OK',
        details: `${usedMemory} / ${maxMemory}`
      });
    } catch (error) {
      checks.push({
        name: 'Memory',
        status: '❌ FAIL',
        details: error.message
      });
    }

    // Connection check
    const stats = await this.getStatistics();
    checks.push({
      name: 'Connections',
      status: '✅ OK',
      details: `${stats.connectedClients} clients`
    });

    // Display results
    const table = new Table({
      head: [chalk.white.bold('Check'), chalk.white.bold('Status'), chalk.white.bold('Details')],
      colWidths: [20, 15, 30]
    });

    checks.forEach(check => {
      table.push([check.name, check.status, check.details]);
    });

    console.log(table.toString());
    console.log();
  }

  /**
   * Disconnect from Redis
   */
  async disconnect() {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
    }

    if (this.redis) {
      await this.redis.quit();
      this.isConnected = false;
    }
  }
}

// CLI setup
const program = new Command();

program
  .name('redis-monitor')
  .description('Redis cache monitoring tool for Global-Fi Ultra')
  .version('1.0.0');

program
  .option('-i, --interactive', 'Start interactive mode')
  .option('-w, --watch', 'Watch mode (auto-refresh)')
  .option('-l, --list-keys', 'List all keys')
  .option('-s, --stats', 'Show statistics only')
  .option('-e, --export <file>', 'Export to JSON file')
  .option('-c, --clear <pattern>', 'Clear keys by pattern')
  .option('-p, --pattern <pattern>', 'Filter by pattern', '*')
  .option('--health', 'Check Redis health')
  .option('--view <key>', 'View specific key details');

program.parse();

const options = program.opts();

// Main execution
(async () => {
  const monitor = new RedisMonitor();

  try {
    await monitor.connect();

    if (options.interactive || (!options.watch && !options.listKeys && !options.stats && !options.export && !options.clear && !options.health && !options.view)) {
      await monitor.startInteractive();
    } else if (options.watch) {
      await monitor.startWatch(options.pattern);
    } else if (options.listKeys) {
      await monitor.displayDashboard(options.pattern);
    } else if (options.stats) {
      const stats = await monitor.getStatistics();
      console.log(JSON.stringify(stats, null, 2));
    } else if (options.export) {
      await monitor.exportData(options.export, options.pattern);
    } else if (options.clear) {
      await monitor.clearKeys(options.clear);
    } else if (options.health) {
      await monitor.healthCheck();
    } else if (options.view) {
      await monitor.viewKey(options.view);
    }

    if (!options.watch) {
      await monitor.disconnect();
      process.exit(0);
    }
  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    await monitor.disconnect();
    process.exit(1);
  }

  // Handle Ctrl+C
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n\n⚠️  Shutting down...\n'));
    await monitor.disconnect();
    process.exit(0);
  });
})();
