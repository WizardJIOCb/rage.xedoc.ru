module.exports = {
  apps: [
    {
      name: 'rage-arena',
      script: './server.js',
      instances: 1, // or 'max' for cluster
      exec_mode: 'fork', // or 'cluster'
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production'
      },
      // Auto restart on crash
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      // Logs
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/err.log',
      out_file: './logs/out.log'
    }
  ]
};