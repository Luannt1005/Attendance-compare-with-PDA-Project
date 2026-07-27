module.exports = {
  apps: [
    {
      name: "timekeeping-app",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 1234",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
