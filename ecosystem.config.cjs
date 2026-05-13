// PM2 process definition for projectsflow.ru
// Запускается на сервере из /var/www/projectsflow/data/www/projectsflow.ru
module.exports = {
  apps: [
    {
      name: "projectsflow",
      script: "server/dist/index.js",
      cwd: "/var/www/projectsflow/data/www/projectsflow.ru",
      node_args: "--env-file=.env",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "300M",
      out_file: "/var/www/projectsflow/data/logs/projectsflow.out.log",
      error_file: "/var/www/projectsflow/data/logs/projectsflow.err.log",
      time: true,
    },
  ],
};
