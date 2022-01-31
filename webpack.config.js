const path = require('path');

module.exports = {
    mode: 'development',
    entry: './src/app.ts',
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                include: [path.resolve(__dirname, 'src')],
            }
        ]
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    devServer: {
        static: {
            directory: path.join(__dirname, 'public'),
        },
        client: {
            logging: 'none',
        },
        compress: false,
    },
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'public')
    }
};