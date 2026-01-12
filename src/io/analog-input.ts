import * as i2c from 'i2c-bus';
import { LightService } from './light';

// ADS1015 Register addresses
const ADS1015_REG_CONVERSION = 0x00;
const ADS1015_REG_CONFIG = 0x01;

// Configuration register bits
const ADS1015_CONFIG_OS_SINGLE = 0x8000; // Single conversion start
const ADS1015_CONFIG_MUX_SINGLE_0 = 0x4000; // Channel 0
const ADS1015_CONFIG_MUX_SINGLE_1 = 0x5000; // Channel 1
const ADS1015_CONFIG_MUX_SINGLE_2 = 0x6000; // Channel 2
const ADS1015_CONFIG_MUX_SINGLE_3 = 0x7000; // Channel 3
const ADS1015_CONFIG_GAIN_ONE = 0x0200; // +/-4.096V range
const ADS1015_CONFIG_MODE_SINGLE = 0x0100; // Single-shot mode
const ADS1015_CONFIG_DR_1600SPS = 0x0080; // 1600 samples per second
const ADS1015_CONFIG_CMODE_TRAD = 0x0000; // Traditional comparator
const ADS1015_CONFIG_CPOL_ACTVLOW = 0x0000; // Alert/Rdy active low
const ADS1015_CONFIG_CLAT_NONLAT = 0x0000; // Non-latching comparator
const ADS1015_CONFIG_CQUE_NONE = 0x0003; // Disable comparator

export class AnalogInputService {
  readonly input1: AnalogInput;
  readonly input2: AnalogInput;
  readonly input3: AnalogInput;
  readonly input4: AnalogInput;

  private i2cBus?: i2c.I2CBus;
  private enabled = false;
  private readonly address = 0x48; // Default ADS1015 address
  private readonly lightService: LightService;

  constructor(lightService: LightService) {
    this.lightService = lightService;

    // Create analog inputs for channels 0-3
    this.input1 = new AnalogInput(0, this);
    this.input2 = new AnalogInput(1, this);
    this.input3 = new AnalogInput(2, this);
    this.input4 = new AnalogInput(3, this);
  }

  /**
   * Enable the analog input service and initialize I2C communication
   */
  enable(): void {
    if (this.enabled) return;

    try {
      // Open I2C bus 1 (standard on Raspberry Pi)
      this.i2cBus = i2c.openSync(1);
      this.enabled = true;

      // Turn on analog input lights
      this.lightService.analogInput1.on();
      this.lightService.analogInput2.on();
      this.lightService.analogInput3.on();
      this.lightService.update();
    } catch (error) {
      console.error('Failed to enable AnalogInputService:', error);
      throw error;
    }
  }

  /**
   * Disable the analog input service and close I2C communication
   */
  disable(): void {
    if (!this.enabled) return;

    try {
      if (this.i2cBus) {
        this.i2cBus.closeSync();
        this.i2cBus = undefined;
      }
      this.enabled = false;

      // Turn off analog input lights
      this.lightService.analogInput1.off();
      this.lightService.analogInput2.off();
      this.lightService.analogInput3.off();
      this.lightService.update();
    } catch (error) {
      console.error('Failed to disable AnalogInputService:', error);
    }
  }

  /**
   * Read all analog inputs
   */
  read(): void {
    if (!this.enabled) {
      throw new Error('AnalogInputService is not enabled. Call enable() first.');
    }

    this.input1.read();
    this.input2.read();
    this.input3.read();
    this.input4.read();
  }

  /**
   * Read a specific channel from the ADS1015
   * @param channel Channel number (0-3)
   * @returns Raw ADC value (12-bit, 0-2047)
   */
  readChannel(channel: number): number {
    if (!this.enabled || !this.i2cBus) {
      throw new Error('AnalogInputService is not enabled. Call enable() first.');
    }

    // Select the correct channel configuration
    let config = ADS1015_CONFIG_CQUE_NONE | // Disable comparator
                 ADS1015_CONFIG_CLAT_NONLAT | // Non-latching
                 ADS1015_CONFIG_CPOL_ACTVLOW | // Alert active low
                 ADS1015_CONFIG_CMODE_TRAD | // Traditional comparator
                 ADS1015_CONFIG_DR_1600SPS | // 1600 samples per second
                 ADS1015_CONFIG_MODE_SINGLE | // Single-shot mode
                 ADS1015_CONFIG_GAIN_ONE | // +/-4.096V range
                 ADS1015_CONFIG_OS_SINGLE; // Start single conversion

    // Set the channel mux
    switch (channel) {
      case 0:
        config |= ADS1015_CONFIG_MUX_SINGLE_0;
        break;
      case 1:
        config |= ADS1015_CONFIG_MUX_SINGLE_1;
        break;
      case 2:
        config |= ADS1015_CONFIG_MUX_SINGLE_2;
        break;
      case 3:
        config |= ADS1015_CONFIG_MUX_SINGLE_3;
        break;
      default:
        throw new Error(`Invalid channel: ${channel}. Must be 0-3.`);
    }

    // Write config register to start conversion
    const configBytes = Buffer.from([
      (config >> 8) & 0xff,
      config & 0xff
    ]);
    this.i2cBus.writeI2cBlockSync(this.address, ADS1015_REG_CONFIG, 2, configBytes);

    // Wait for conversion to complete (conversion time for ADS1015 at 1600SPS is ~0.625ms)
    // Adding extra time for safety
    const delay = 2;
    const start = Date.now();
    while (Date.now() - start < delay) {
      // Busy wait
    }

    // Read the conversion result
    const buffer = Buffer.alloc(2);
    this.i2cBus.readI2cBlockSync(this.address, ADS1015_REG_CONVERSION, 2, buffer);

    // Convert to 12-bit value (ADS1015 returns 12-bit data in 16-bit format)
    const value = (buffer[0] << 8) | buffer[1];
    return value >> 4; // Right shift by 4 to get 12-bit value
  }
}

export class AnalogInput {
  private readonly channel: number;
  private readonly service: AnalogInputService;
  private currentValue = 0;

  constructor(channel: number, service: AnalogInputService) {
    this.channel = channel;
    this.service = service;
  }

  /**
   * Get the current raw ADC value (0-2047 for 12-bit ADC)
   */
  get raw(): number {
    return this.currentValue;
  }

  /**
   * Get the voltage value (0-25.85V accounting for voltage divider)
   * The Automation HAT has a 120k/10k voltage divider on analog inputs
   */
  get voltage(): number {
    // ADS1015 is 12-bit, with 4.096V reference
    const adcVoltage = (this.currentValue / 2047.0) * 4.096;
    // Account for voltage divider (120k + 10k) / 10k = 13
    return adcVoltage * 13;
  }

  /**
   * Get the percentage value (0-100%)
   */
  get percent(): number {
    return (this.currentValue / 2047.0) * 100;
  }

  /**
   * Read the current value from the ADC
   */
  read(): number {
    this.currentValue = this.service.readChannel(this.channel);
    return this.currentValue;
  }
}