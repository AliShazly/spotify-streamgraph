const path = require('path');
const WasmPackPlugin = require('@wasm-tool/wasm-pack-plugin');

module.exports = {
    mode: 'production',
    performance: {
        maxAssetSize: 500_000,
        maxEntrypointSize: 500_000
    },
    entry: './ts/app.ts',
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                include: [path.resolve(__dirname, 'ts')]
            }
        ]
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    devServer: {
        static: [
            {
                directory: path.join(__dirname, 'public')
            }
        ],
        client: {
            logging: 'none',
            webSocketTransport: 'ws'
        },
        webSocketServer: 'ws',
        compress: false
    },
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'public')
    },
    plugins: [
        new WasmPackPlugin({
            crateDirectory: __dirname
        })
    ],
    experiments: { syncWebAssembly: true, topLevelAwait: true }
};
