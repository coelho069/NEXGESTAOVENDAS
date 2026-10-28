module.exports = {
  apps: [{
    name: "nexgestaovendas",
    script: "/home/ubuntu/releases/v1.0.1-anne-20261016204316/server.js",
    cwd: "/home/ubuntu/releases/v1.0.1-anne-20261016204316",
    instances: 1,
    exec_mode: "fork",
    env: {
      NODE_ENV: "production",
      PORT: 3211,
      HOSTNAME: "127.0.0.1"
    }
  }]
};
