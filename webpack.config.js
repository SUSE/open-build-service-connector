// Original file taken from:
// https://github.com/microsoft/vscode-extension-samples/blob/master/webpack-sample/webpack.config.js
// adapted for further usage by Dan Čermák, SUSE LLC
/*
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 */

//@ts-check

"use strict";

const path = require("path");

const createWebpackConfig = (
  configFile,
  { exclude = /node_modules/, include = undefined } = {}
) => ({
  target: "node",
  devtool: "source-map",
  resolve: {
    extensions: [".ts", ".js"]
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude,
        include,
        use: [
          {
            loader: "ts-loader",
            options: {
              compilerOptions: {
                module: "es6"
              },
              context: __dirname,
              configFile: path.resolve(__dirname, configFile)
            }
          }
        ]
      },
      {
        test: /\.node$/,
        loader: "awesome-node-loader",
        options: {
          name: "[name].[ext]"
        }
      }
    ]
  }
});

/**@type {import('webpack').Configuration}*/
const extensionConfig = {
  ...createWebpackConfig("./tsconfig.json"),
  entry: "./src/extension.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    library: { type: "commonjs2" },
    devtoolModuleFilenameTemplate: "../[resource-path]"
  },
  externals: {
    vscode: "commonjs vscode"
  }
};

/**@type {import('webpack').Configuration}*/
const frontendConfig = {
  ...createWebpackConfig("./tsconfig.frontend.json", {
    exclude: undefined,
    include: [
      path.resolve(__dirname, "src", "history-graph-common.ts"),
      path.resolve(__dirname, "src", "frontend", "draw-graph.ts")
    ]
  }),
  entry: "./src/frontend/draw-graph.ts",
  output: {
    path: path.resolve(__dirname, "media", "html"),
    filename: "draw-graph.js",
    library: { type: "commonjs" }
  }
};

module.exports = [extensionConfig, frontendConfig];
