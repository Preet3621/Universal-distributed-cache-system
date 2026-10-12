import { parseCommand, ProtocolError } from '../../../packages/protocol/index.js';
import { ClientError } from '../../../packages/client/index.js';

/**
 * @typedef {import('../../../packages/client/src/cluster-client.js').ClusterClient} ClusterClient
 */

/**
 * @param {ClusterClient} cluster
 * @param {string} commandLine
 */
export async function runClusterCommand(cluster, commandLine) {
  let cmd;
  try {
    cmd = parseCommand(commandLine);
  } catch (err) {
    const message = err instanceof ProtocolError ? err.message : String(err);
    console.log(`(error) ${message}`);
    return;
  }

  try {
    await dispatchClusterCommand(cluster, cmd);
  } catch (err) {
    if (err instanceof ClientError) {
      if (err.code === 'NODE_UNAVAILABLE' && err.details) {
        console.log(
          `(error) ${err.message} [node ${err.details.nodeId} index ${err.details.nodeIndex}]`,
        );
        return;
      }
      console.log(`(error) ${err.message}`);
      return;
    }
    throw err;
  }
}

/**
 * @param {ClusterClient} cluster
 * @param {import('../../../packages/protocol/src/codec.js').Command} cmd
 */
async function dispatchClusterCommand(cluster, cmd) {
  switch (cmd.name) {
    case 'PING':
      await cluster.ping();
      console.log('PONG');
      break;
    case 'GET': {
      const value = await cluster.get(cmd.key);
      if (value === null) {
        console.log('NIL');
      } else {
        console.log(`"${value}"`);
      }
      break;
    }
    case 'SET':
      if (cmd.ex !== undefined) {
        await cluster.set(cmd.key, cmd.value, { ex: cmd.ex });
      } else {
        await cluster.set(cmd.key, cmd.value);
      }
      console.log('OK');
      break;
    case 'DEL':
    case 'DELETE': {
      const removed = await cluster.del(cmd.key);
      console.log(`(integer) ${removed ? 1 : 0}`);
      break;
    }
    case 'EXISTS': {
      const exists = await cluster.exists(cmd.key);
      console.log(`(integer) ${exists ? 1 : 0}`);
      break;
    }
    case 'TTL': {
      const ttl = await cluster.ttl(cmd.key);
      console.log(`(integer) ${ttl}`);
      break;
    }
    default:
      console.log('(error) unsupported command');
  }
}
