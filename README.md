# modelRxiv

Repository for the modeling platform modelRxiv, which can be accessed at https://modelrxiv.org. This repository contains the code for the platform, and additional utilities that can be used to connect to modelRxiv without using a browser.

# Contributing

We have a community Slack for the project, to join please use the invitation url at https://modelrxiv.org/contribute.

# Backend utility

The backend utility is designed to allow users to pool resources for model computation and allow computation in additional environments that are compatible with a wider range of programming languages and frameworks.

## Requirements

* Node.js 14+
* npm

## Installation

To install the utility, clone the repository to the local machine and browse to the `/utils/backend` directory in the repository from a terminal window and run npm:

```
npm update
```

## Basic usage

To launch the utility, simply run the init.js script file with Node.js:

```
node init.js
```

You will be prompted for a nickname and password; these are the same credentials as those used on the browser interface. Once authenticated and connected to the WebSocket server, the machine will appear in the resources menu on the browser interface.

The utility will process batches so long as it is connected to modelRxiv and the user session has not expired. To terminate the utility, press `ctrl+c`.

## Flags

The following flags allow customization of the resources provided by the connected machine:

```
Common flags
--threads     An integer, defines the number of threads to make available for model computation (default = 4)
--name        A user-defined label describing the machine that will appear in the resources menu (default = 'node')
--mode        At the moment this accepts two values, 'subprocess' (default) and 'slurm' (send batches as jobs to Slurm)

Flags for advanced/internal usage
--request     The name of a file containing the request in JSON format, this is used for delayed batch processing
              If provided, the utility will process the batch immediately and terminate when it is finished processing
--url         An alternative URL for a WebSocket server if using a different service (default is modelRxiv)
```

For example, to connect a machine using 20 threads with the label 'Home', use the following command:

```
node init.js --threads=20 --name=Home
```
