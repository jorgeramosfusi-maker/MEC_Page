document.addEventListener('DOMContentLoaded', () => {
    const connectButton = document.getElementById('connectButton');
    const getLogButton = document.getElementById('getLogButton');
    const clearLogsButton = document.getElementById('clearLogsButton');
    const logDataTextArea = document.getElementById('logData');
    const bleStatusText = document.getElementById('bleStatusText');
    const bleStatusIndicator = document.getElementById('bleStatusIndicator');

    let device;
    let server;
    let service;
    let statusCharacteristic;
    let logDataCharacteristic;
    let commandCharacteristic;

    const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
    const DEVICE_STATUS_CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
    const LOG_DATA_CHARACTERISTIC_UUID = "a7e3c4d8-974f-464a-b275-cf3f0e6a433f";
    const COMMAND_CHARACTERISTIC_UUID = "c1e45678-9012-3456-7890-123456789012";

    let statusInterval;

    connectButton.addEventListener('click', connectToDevice);
    getLogButton.addEventListener('click', () => sendCommand('send_log'));
    clearLogsButton.addEventListener('click', () => sendCommand('clear_logs'));

    async function connectToDevice() {
        try {
            console.log('Requesting Bluetooth device...');
            bleStatusText.textContent = 'Requesting...';
            device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [SERVICE_UUID] }]
            });

            console.log('Device found:', device.name);
            bleStatusText.textContent = 'Connecting...';
            device.addEventListener('gattserverdisconnected', onDisconnected);
            server = await device.gatt.connect();

            console.log('Connected to GATT Server');
            bleStatusText.textContent = 'Discovering...';
            service = await server.getPrimaryService(SERVICE_UUID);

            console.log('Service discovered');
            bleStatusText.textContent = 'Getting Chars...';
            statusCharacteristic = await service.getCharacteristic(DEVICE_STATUS_CHARACTERISTIC_UUID);
            logDataCharacteristic = await service.getCharacteristic(LOG_DATA_CHARACTERISTIC_UUID);
            commandCharacteristic = await service.getCharacteristic(COMMAND_CHARACTERISTIC_UUID);

            console.log('Characteristics discovered');
            bleStatusIndicator.className = "wifi-status connected";
            bleStatusText.textContent = "Connected";
            connectButton.textContent = "Disconnect";
            connectButton.removeEventListener('click', connectToDevice);
            connectButton.addEventListener('click', disconnectDevice);

            // Start listening for log data
            await logDataCharacteristic.startNotifications();
            logDataCharacteristic.addEventListener('characteristicvaluechanged', handleLogData);

            // Start polling for status
            statusInterval = setInterval(readStatus, 2000);
            readStatus(); // Initial read

        } catch(error) {
            console.error('Connection failed:', error);
            bleStatusText.textContent = 'Error';
            bleStatusIndicator.className = "wifi-status disconnected";
        }
    }

    function onDisconnected() {
        console.log('Device disconnected');
        bleStatusIndicator.className = "wifi-status disconnected";
        bleStatusText.textContent = "Offline";
        connectButton.textContent = "Connect to Logger";
        connectButton.removeEventListener('click', disconnectDevice);
        connectButton.addEventListener('click', connectToDevice);
        clearInterval(statusInterval);
    }

    async function disconnectDevice() {
        if (device && device.gatt.connected) {
            await device.gatt.disconnect();
        }
    }

    async function readStatus() {
        if (!statusCharacteristic) return;
        try {
            const value = await statusCharacteristic.readValue();
            const decoder = new TextDecoder('utf-8');
            const statusString = decoder.decode(value);
            processStatusData(statusString);
        } catch(error) {
            console.error('Error reading status:', error);
        }
    }

    async function sendCommand(command) {
        if (!commandCharacteristic) {
            alert("Not connected to a device.");
            return;
        }
        try {
            const encoder = new TextEncoder();
            console.log(`Sending command: ${command}`);
            if (command === 'send_log') {
                logDataTextArea.value = "Requesting log file...\n";
            }
            await commandCharacteristic.writeValue(encoder.encode(command));
            console.log('Command sent successfully.');
        } catch(error) {
            console.error('Error sending command:', error);
            alert(`Failed to send command: ${error}`);
        }
    }

    function handleLogData(event) {
        const value = event.target.value;
        const decoder = new TextDecoder('utf-8');
        const textChunk = decoder.decode(value);

        if (textChunk === "EOF") {
            logDataTextArea.value += "\n--- End of File ---";
        } else {
            logDataTextArea.value += textChunk;
        }
        // Auto-scroll to the bottom
        logDataTextArea.scrollTop = logDataTextArea.scrollHeight;
    }

    function processStatusData(statusString) {
        // Example status: "SoC: 98.5%, V: 25.40V, I: 0.10A"
        const parts = statusString.split(',');
        let data = {};
        parts.forEach(part => {
            const [key, value] = part.split(':');
            if (key && value) {
                const trimmedKey = key.trim();
                const trimmedValue = value.trim();
                if (trimmedKey === 'SoC') data.batteryPercentage = parseFloat(trimmedValue);
                if (trimmedKey === 'V') data.batteryVoltage = parseFloat(trimmedValue);
                if (trimmedKey === 'I') data.batteryCurrent = parseFloat(trimmedValue);
            }
        });

        // This is a simplified version of the original processData function
        // It can be expanded to parse more complex data if needed.
        if (data.batteryPercentage !== undefined) {
            updateGauge('batteryGauge', data.batteryPercentage);
            document.getElementById("batteryValue").innerHTML = data.batteryPercentage.toFixed(0);
        }
        document.getElementById("batteryVoltage").innerHTML = data.batteryVoltage !== undefined ? data.batteryVoltage.toFixed(2) : "N/A";
        document.getElementById("batteryCurrent").innerHTML = data.batteryCurrent !== undefined ? data.batteryCurrent.toFixed(2) : "N/A";
    }

    function updateGauge(gaugeId, value, max_val = 100) {
      if (typeof value !== 'number' || isNaN(value)) return;
      let percentage = (max_val > 0) ? (value / max_val) * 100 : 0;
      if (percentage < 0) percentage = 0;
      if (percentage > 100) percentage = 100;
      const gaugeElement = document.getElementById(gaugeId);
      if (gaugeElement) {
        const degrees = percentage * 3.6;
        gaugeElement.style.background = `conic-gradient(#4CAF50 ${degrees}deg, #333 ${degrees}deg)`;
      }
    }
});
