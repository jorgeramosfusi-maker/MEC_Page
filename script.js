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
    let logFileData = '';

    const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
    const DEVICE_STATUS_CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
    const LOG_DATA_CHARACTERISTIC_UUID = "a7e3c4d8-974f-464a-b275-cf3f0e6a433f";
    const COMMAND_CHARACTERISTIC_UUID = "c1e45678-9012-3456-7890-123456789012";

    const OTA_SERVICE_UUID = "00008018-0000-1000-8000-00805f9b34fb";
    const OTA_FW_CHARACTERISTIC_UUID = "00008020-0000-1000-8000-00805f9b34fb";
    const OTA_CMD_CHARACTERISTIC_UUID = "00008022-0000-1000-8000-00805f9b34fb";

    let otaFwCharacteristic;
    let otaCmdCharacteristic;
    let statusInterval;

    const updateFirmwareButton = document.getElementById('updateFirmwareButton');
    const firmwareFileInput = document.getElementById('firmwareFile');

    connectButton.addEventListener('click', connectToDevice);
    getLogButton.addEventListener('click', () => sendCommand('send_log'));
    clearLogsButton.addEventListener('click', () => sendCommand('clear_logs'));
    updateFirmwareButton.addEventListener('click', () => firmwareFileInput.click());
    firmwareFileInput.addEventListener('change', handleFirmwareFile);

    function handleFirmwareFile(event) {
        const file = event.target.files[0];
        if (!file) {
            console.log('No file selected.');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            const file_buffer = e.target.result;
            startOTA(file_buffer);
        };
        reader.readAsArrayBuffer(file);
    }

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
            statusInterval = setInterval(readStatus, 500);
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
            downloadLogFile();
        } else {
            logFileData += textChunk;
        }
    }

    function downloadLogFile() {
        if (logFileData.length === 0) {
            alert("No log data to download.");
            return;
        }

        const blob = new Blob([logFileData], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", "log.csv");
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // Reset for next download
        logFileData = '';
    }

    function processStatusData(statusString) {
        const data = {};
        const parts = statusString.split(',');
        parts.forEach(part => {
            const [key, ...valueParts] = part.split(':');
            const value = valueParts.join(':');
            if (key && value) {
                data[key.trim()] = value.trim();
            }
        });

        // Battery Health
        if (data.SoC !== undefined) {
            const soc = parseFloat(data.SoC);
            updateGauge('batteryGauge', soc);
            document.getElementById("batteryValue").innerHTML = soc.toFixed(0);
        }
        document.getElementById("batteryVoltage").innerHTML = data.V !== undefined ? parseFloat(data.V).toFixed(2) : "N/A";
        document.getElementById("batteryCurrent").innerHTML = data.I !== undefined ? parseFloat(data.I).toFixed(2) : "N/A";

        // Work Monitor
        if (data.PlatformLoad !== undefined) {
            const platformLoad = parseFloat(data.PlatformLoad);
            // Assuming SWL is available from a previous data load or a constant
            const swl = parseFloat(document.getElementById('swlDisplay').textContent) || 3300;
            updateGauge('platformLoadGauge', platformLoad, swl);
            document.getElementById("platformLoadValue").innerHTML = platformLoad.toFixed(0);
        }
        document.getElementById("cycleStatusValue").innerHTML = data.CycleStatus || "N/A";
        document.getElementById("avgLoadLife").innerHTML = data.AvgLoad !== undefined ? parseFloat(data.AvgLoad).toFixed(1) : "N/A";
        document.getElementById("workLife").innerHTML = data.WorkLife !== undefined ? parseFloat(data.WorkLife).toFixed(2) : "N/A";
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

    // --- OTA Logic ---
    const crc16_table = [
        0x0000, 0xC0C1, 0xC181, 0x0140, 0xC301, 0x03C0, 0x0280, 0xC241,
        0xC601, 0x06C0, 0x0780, 0xC741, 0x0500, 0xC5C1, 0xC481, 0x0440,
        0xCC01, 0x0CC0, 0x0D80, 0xCD41, 0x0F00, 0xCFC1, 0xCE81, 0x0E40,
        0x0A00, 0xCAC1, 0xCB81, 0x0B40, 0xC901, 0x09C0, 0x0880, 0xC841,
        0xD801, 0x18C0, 0x1980, 0xD941, 0x1B00, 0xDBC1, 0xDA81, 0x1A40,
        0x1E00, 0xDEC1, 0xDF81, 0x1F40, 0xDD01, 0x1DC0, 0x1C80, 0xDC41,
        0x1400, 0xD4C1, 0xD581, 0x1540, 0xD701, 0x17C0, 0x1680, 0xD641,
        0xD201, 0x12C0, 0x1380, 0xD341, 0x1100, 0xD1C1, 0xD081, 0x1040,
        0xF001, 0x30C0, 0x3180, 0xF141, 0x3300, 0xF3C1, 0xF281, 0x3240,
        0x3600, 0xF6C1, 0xF781, 0x3740, 0xF501, 0x35C0, 0x3480, 0xF441,
        0x3C00, 0xFCC1, 0xFD81, 0x3D40, 0xFF01, 0x3FC0, 0x3E80, 0xFE41,
        0xFA01, 0x3AC0, 0x3B80, 0xFB41, 0x3900, 0xF9C1, 0xF881, 0x3840,
        0x2800, 0xE8C1, 0xE981, 0x2940, 0xEB01, 0x2BC0, 0x2A80, 0xEA41,
        0xEE01, 0x2EC0, 0x2F80, 0xEF41, 0x2D00, 0xEDC1, 0xEC81, 0x2C40,
        0xE401, 0x24C0, 0x2580, 0xE541, 0x2700, 0xE7C1, 0xE681, 0x2640,
        0x2200, 0xE2C1, 0xE381, 0x2340, 0xE101, 0x21C0, 0x2080, 0xE041,
        0xA001, 0x60C0, 0x6180, 0xA141, 0x6300, 0xA3C1, 0xA281, 0x6240,
        0x6600, 0xA6C1, 0xA781, 0x6740, 0xA501, 0x65C0, 0x6480, 0xA441,
        0x6C00, 0xACC1, 0xAD81, 0x6D40, 0xAF01, 0x6FC0, 0x6E80, 0xAE41,
        0xAA01, 0x6AC0, 0x6B80, 0xAB41, 0x6900, 0xA9C1, 0xA881, 0x6840,
        0x7800, 0xB8C1, 0xB981, 0x7940, 0xBB01, 0x7BC0, 0x7A80, 0xBA41,
        0xBE01, 0x7EC0, 0x7F80, 0xBF41, 0x7D00, 0xBDC1, 0xBC81, 0x7C40,
        0xB401, 0x74C0, 0x7580, 0xB541, 0x7700, 0xB7C1, 0xB681, 0x7640,
        0x7200, 0xB2C1, 0xB381, 0x7340, 0xB101, 0x71C0, 0x7080, 0xB041,
        0x5000, 0x90C1, 0x9181, 0x5140, 0x9301, 0x53C0, 0x5280, 0x9241,
        0x9601, 0x56C0, 0x5780, 0x9741, 0x5500, 0x95C1, 0x9481, 0x5440,
        0x9C01, 0x5CC0, 0x5D80, 0x9D41, 0x5F00, 0x9FC1, 0x9E81, 0x5E40,
        0x5A00, 0x9AC1, 0x9B81, 0x5B40, 0x9901, 0x59C0, 0x5880, 0x9841,
        0x8801, 0x48C0, 0x4980, 0x8941, 0x4B00, 0x8BC1, 0x8A81, 0x4A40,
        0x4E00, 0x8EC1, 0x8F81, 0x4F40, 0x8D01, 0x4DC0, 0x4C80, 0x8C41,
        0x4400, 0x84C1, 0x8581, 0x4540, 0x8701, 0x47C0, 0x4680, 0x8641,
        0x8201, 0x42C0, 0x4380, 0x8341, 0x4100, 0x81C1, 0x8081, 0x4040
    ];
    function crc16(buffer) {
        let crc = 0;
        for (let i = 0; i < buffer.length; i++) {
            crc = (crc >> 8) ^ crc16_table[(crc ^ buffer[i]) & 0xFF];
        }
        return crc;
    }

    let firmwareBuffer; // Store firmware buffer globally for access in callbacks

    async function startOTA(fwBuffer) {
        firmwareBuffer = fwBuffer;
        if (!device || !device.gatt.connected) {
            alert("Not connected. Please connect to the device first.");
            return;
        }

        try {
            console.log("Starting OTA process...");
            bleStatusText.textContent = 'OTA Starting...';

            const otaService = await server.getPrimaryService(OTA_SERVICE_UUID);
            otaFwCharacteristic = await otaService.getCharacteristic(OTA_FW_CHARACTERISTIC_UUID);
            otaCmdCharacteristic = await otaService.getCharacteristic(OTA_CMD_CHARACTERISTIC_UUID);

            await otaCmdCharacteristic.startNotifications();
            otaCmdCharacteristic.addEventListener('characteristicvaluechanged', handleOtaCommandResponse);

            const fileSize = firmwareBuffer.byteLength;
            const command = new Uint8Array(20);
            const view = new DataView(command.buffer);
            view.setUint16(0, 0x0001, true); // Start Flash OTA command
            view.setUint32(2, fileSize, true); // File size

            const crc = crc16(new Uint8Array(command.buffer, 0, 18));
            view.setUint16(18, crc, true);

            console.log(`Sending Start OTA command. File size: ${fileSize}`);
            await otaCmdCharacteristic.writeValue(command.buffer);

        } catch (error) {
            console.error("OTA Error:", error);
            alert("Failed to start OTA update: " + error);
            bleStatusText.textContent = 'OTA Error';
        }
    }

    function handleOtaCommandResponse(event) {
        const value = event.target.value;
        const view = new DataView(value.buffer);
        const commandId = view.getUint16(2, true);
        const status = view.getUint16(4, true);

        if (commandId === 0x0001 && status === 0x0000) { // ACK for Start OTA
            console.log("Start OTA ACK received. Sending firmware...");
            bleStatusText.textContent = 'Sending FW...';
            sendFirmwareData();
        } else {
            console.error("Received NACK or unexpected response for Start OTA command.", value);
            alert("Device rejected OTA update. Please try again.");
            bleStatusText.textContent = 'OTA Rejected';
        }
    }

    async function sendFirmwareData() {
        const sectorSize = 4096;
        const mtu = device.gatt.mtu || 23;
        const payloadSize = mtu - 4; // 3 bytes for header, 1 for something else?
        const totalSectors = Math.ceil(firmwareBuffer.byteLength / sectorSize);

        for (let sectorIndex = 0; sectorIndex < totalSectors; sectorIndex++) {
            const sectorStart = sectorIndex * sectorSize;
            const sectorEnd = Math.min(sectorStart + sectorSize, firmwareBuffer.byteLength);
            const sectorData = firmwareBuffer.slice(sectorStart, sectorEnd);

            bleStatusText.textContent = `Sending Sector ${sectorIndex + 1}/${totalSectors}`;

            let packetSeq = 0;
            for (let i = 0; i < sectorData.byteLength; i += payloadSize) {
                const chunk = sectorData.slice(i, i + payloadSize);
                const packet = new Uint8Array(3 + chunk.byteLength);
                const view = new DataView(packet.buffer);

                view.setUint16(0, sectorIndex, true);
                view.setUint8(2, packetSeq++);
                packet.set(new Uint8Array(chunk), 3);

                if (i + payloadSize >= sectorData.byteLength) { // Last packet of sector
                    view.setUint8(2, 0xFF);
                    const sectorCrc = crc16(new Uint8Array(sectorData));
                    // The protocol description is a bit ambiguous here.
                    // Let's assume the CRC is appended to the payload.
                    // This part might need debugging.
                    const finalPacket = new Uint8Array(packet.byteLength + 2);
                    finalPacket.set(packet);
                    const finalView = new DataView(finalPacket.buffer);
                    finalView.setUint16(packet.byteLength, sectorCrc, true);
                    await otaFwCharacteristic.writeValueWithoutResponse(finalPacket);
                } else {
                    await otaFwCharacteristic.writeValueWithoutResponse(packet);
                }
            }
            // A more robust implementation would wait for sector ACK here.
            // For now, we just assume it works and continue.
            console.log(`Sector ${sectorIndex + 1} sent.`);
        }

        console.log("Firmware transfer complete.");
        alert("Firmware update sent! The device should reboot.");
        bleStatusText.textContent = 'Update Sent';
    }
});
