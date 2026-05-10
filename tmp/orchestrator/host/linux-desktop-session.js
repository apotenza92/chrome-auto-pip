'use strict';

const { spawnSync } = require('child_process');

const SESSION_FIELDS = [
  'Id',
  'Name',
  'User',
  'Active',
  'State',
  'Leader',
  'Class',
  'Type',
  'Remote',
  'Display',
  'VTNr',
  'Seat',
  'LockedHint'
];

const RELEVANT_ENV_KEYS = [
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'DBUS_SESSION_BUS_ADDRESS',
  'XDG_CURRENT_DESKTOP',
  'XDG_SESSION_TYPE',
  'XDG_RUNTIME_DIR',
  'DESKTOP_SESSION',
  'GDMSESSION',
  'HOME',
  'USER',
  'LOGNAME',
  'PATH'
];

function runLocal(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options
  });
  if (result.error) throw result.error;
  return result;
}

function runGuestBash(target, script, options = {}) {
  return runLocal('prlctl', buildPrlctlExecArgs(target, ['bash', '-s'], { preferRoot: !!options.preferRoot }), {
    timeout: options.timeout || 30000,
    input: script,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
}

function quotePosix(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildPrlctlExecArgs(target, args, options = {}) {
  const preferRoot = !!options.preferRoot;
  if (preferRoot && target.guestFamily === 'linux' && target.guestStageExecMode === 'root') {
    return ['exec', target.vmName, ...args];
  }
  const authArgs = target.execUser
    ? ['--user', target.execUser, '--password', target.execPassword || '']
    : target.guestFamily === 'windows'
      ? []
      : ['--current-user'];
  return ['exec', target.vmName, ...authArgs, ...args];
}

function parseKeyValueText(text) {
  const output = {};
  String(text || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => {
      const index = line.indexOf('=');
      if (index === -1) return;
      output[line.slice(0, index)] = line.slice(index + 1) || null;
    });
  return output;
}

function normaliseSession(raw) {
  return {
    id: raw.Id || null,
    name: raw.Name || null,
    userId: raw.User || null,
    active: raw.Active === 'yes',
    state: raw.State || null,
    leaderPid: raw.Leader ? parseInt(raw.Leader, 10) || null : null,
    class: raw.Class || null,
    type: raw.Type || null,
    remote: raw.Remote === 'yes',
    display: raw.Display || null,
    vtNr: raw.VTNr ? parseInt(raw.VTNr, 10) || 0 : 0,
    seat: raw.Seat || null,
    locked: raw.LockedHint === 'yes'
  };
}

function listLinuxSessions(target) {
  const script = [
    'for session_id in $(loginctl list-sessions --no-legend | awk \'$1 != "SESSION" {print $1}\'); do',
    '  echo "__SESSION__=$session_id"',
    `  loginctl show-session "$session_id" ${SESSION_FIELDS.map((field) => `-p ${field}`).join(' ')} 2>/dev/null || true`,
    '  echo "__END__"',
    'done'
  ].join('\n');

  const result = runGuestBash(target, script, { preferRoot: true, timeout: 30000 });
  if (result.status !== 0) {
    throw new Error(`Failed to inspect Linux desktop sessions\n${result.stdout}${result.stderr}`.trim());
  }

  const sessions = [];
  let current = [];
  String(result.stdout || '')
    .split(/\r?\n/)
    .forEach((line) => {
      if (line.startsWith('__SESSION__=')) {
        current = [];
        return;
      }
      if (line === '__END__') {
        const parsed = parseKeyValueText(current.join('\n'));
        if (parsed.Id) sessions.push(normaliseSession(parsed));
        current = [];
        return;
      }
      current.push(line);
    });
  return sessions;
}

function scoreSession(session) {
  let score = 0;
  if (session.active) score += 100;
  if (session.class === 'user') score += 80;
  if (session.seat === 'seat0') score += 60;
  if (session.type === 'x11') score += 50;
  else if (session.type === 'wayland') score += 40;
  if (session.vtNr > 0) score += 20;
  if (!session.locked) score += 15;
  if (!session.remote) score += 10;
  if (session.display) score += 5;
  return score;
}

function choosePreferredLinuxSession(sessions) {
  return [...sessions]
    .sort((left, right) => {
      const scoreDelta = scoreSession(right) - scoreSession(left);
      if (scoreDelta !== 0) return scoreDelta;
      return (right.vtNr || 0) - (left.vtNr || 0);
    })[0] || null;
}

function listUserProcesses(target, session) {
  const sessionUser = session && session.name ? session.name : null;
  if (!sessionUser) return [];
  const script = `ps -u ${quotePosix(sessionUser)} -o pid=,tty=,comm= 2>/dev/null || true`;
  const result = runGuestBash(target, script, { preferRoot: true, timeout: 30000 });
  if (result.status !== 0) return [];
  return String(result.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/);
      if (!match) return null;
      return {
        pid: parseInt(match[1], 10),
        tty: match[2],
        command: match[3]
      };
    })
    .filter(Boolean);
}

function chooseEnvironmentProcess(session, processes) {
  if (!processes.length) return null;
  const ttyName = session && session.vtNr > 0 ? `tty${session.vtNr}` : null;
  const onSessionTty = ttyName
    ? processes.filter((process) => process.tty === ttyName)
    : [];
  const candidates = onSessionTty.length ? onSessionTty : processes;
  const preferredPrefixes = [
    'gnome-shell',
    'gnome-session-b',
    'gnome-session-binary',
    'mutter-x11-fram',
    'gdm-x-session',
    'dbus-broker'
  ];
  for (const prefix of preferredPrefixes) {
    const match = candidates.find((process) => String(process.command || '').startsWith(prefix));
    if (match) return match;
  }
  return candidates[0] || null;
}

function readProcessEnvironment(target, pid) {
  const script = `tr '\\0' '\\n' </proc/${pid}/environ 2>/dev/null || true`;
  const result = runGuestBash(target, script, { preferRoot: true, timeout: 30000 });
  if (result.status !== 0) return {};
  const env = {};
  String(result.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => {
      const index = line.indexOf('=');
      if (index === -1) return;
      const key = line.slice(0, index);
      if (!RELEVANT_ENV_KEYS.includes(key)) return;
      env[key] = line.slice(index + 1) || null;
    });
  return env;
}

function readUserManagerEnvironment(target) {
  const result = runLocal('prlctl', buildPrlctlExecArgs(target, ['systemctl', '--user', 'show-environment']), {
    timeout: 30000
  });
  if (result.status !== 0) return {};
  const parsed = parseKeyValueText(result.stdout || '');
  const env = {};
  RELEVANT_ENV_KEYS.forEach((key) => {
    if (parsed[key]) env[key] = parsed[key];
  });
  return env;
}

function mergeEnvironment(session, processEnv, managerEnv) {
  const env = {
    ...managerEnv,
    ...processEnv
  };
  if (!env.XDG_SESSION_TYPE && session && session.type) env.XDG_SESSION_TYPE = session.type;
  if (!env.USER && session && session.name) env.USER = session.name;
  if (!env.LOGNAME && session && session.name) env.LOGNAME = session.name;
  if (!env.DISPLAY && session && session.type === 'x11') env.DISPLAY = ':0';
  if (!env.XDG_RUNTIME_DIR && session && session.userId) env.XDG_RUNTIME_DIR = `/run/user/${session.userId}`;
  if (!env.XAUTHORITY && env.XDG_RUNTIME_DIR) env.XAUTHORITY = `${env.XDG_RUNTIME_DIR}/gdm/Xauthority`;
  return env;
}

function getLinuxDesktopSessionContext(target) {
  if (!target || target.guestFamily !== 'linux') return null;
  const sessions = listLinuxSessions(target);
  const selectedSession = choosePreferredLinuxSession(sessions);
  if (!selectedSession) {
    return {
      sessions,
      selectedSession: null,
      sessionEnv: null,
      envSourceProcess: null
    };
  }

  const processes = listUserProcesses(target, selectedSession);
  const envSourceProcess = chooseEnvironmentProcess(selectedSession, processes);
  const processEnv = envSourceProcess ? readProcessEnvironment(target, envSourceProcess.pid) : {};
  const managerEnv = readUserManagerEnvironment(target);
  const sessionEnv = mergeEnvironment(selectedSession, processEnv, managerEnv);

  return {
    sessions,
    selectedSession,
    sessionEnv: Object.keys(sessionEnv).length ? sessionEnv : null,
    envSourceProcess: envSourceProcess || null
  };
}

function buildLinuxDesktopEnvCommand(env, command) {
  const pairs = Object.entries(env || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${quotePosix(value)}`);
  if (!pairs.length) return command;
  return `env ${pairs.join(' ')} ${command}`;
}

function prepareLinuxDesktopSession(target) {
  const context = getLinuxDesktopSessionContext(target);
  if (!context || !context.selectedSession) {
    return {
      ok: false,
      summary: 'Could not resolve an active Linux desktop session',
      context
    };
  }

  const session = context.selectedSession;
  const scriptLines = [
    `loginctl unlock-session ${quotePosix(session.id)} >/dev/null 2>&1 || true`,
    `loginctl activate ${quotePosix(session.id)} >/dev/null 2>&1 || true`
  ];
  if (session.vtNr > 0) {
    scriptLines.push(`chvt ${quotePosix(session.vtNr)} >/dev/null 2>&1 || true`);
    scriptLines.push('sleep 1');
  }
  if (context.sessionEnv && context.sessionEnv.DISPLAY) {
    scriptLines.push(buildLinuxDesktopEnvCommand(context.sessionEnv, 'bash -lc \'xset s off -dpms s noblank >/dev/null 2>&1 || true; xset dpms force on >/dev/null 2>&1 || true\''));
  }
  scriptLines.push(`loginctl show-session ${quotePosix(session.id)} -p Active -p LockedHint -p State -p Type -p Class -p VTNr 2>/dev/null || true`);

  const result = runGuestBash(target, scriptLines.join('\n'), { preferRoot: true, timeout: 30000 });

  return {
    ok: result.status === 0,
    summary: result.status === 0
      ? 'Prepared Linux desktop session before host capture'
      : 'Linux desktop session preparation failed before host capture',
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    context
  };
}

module.exports = {
  getLinuxDesktopSessionContext,
  prepareLinuxDesktopSession
};
