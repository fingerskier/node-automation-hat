import { AnalogInputService, AnalogInput } from './analog-input';
import { LightService } from './light';
import * as i2c from 'i2c-bus';

// Mock the i2c-bus module
jest.mock('i2c-bus');
// Mock the light service to avoid rpio initialization issues
jest.mock('./light');

describe('test analog inputs', () => {
  let service: AnalogInputService;
  let lightService: LightService;
  let mockI2cBus: jest.Mocked<i2c.I2CBus>;

  beforeAll(() => {
    // Mock i2c bus methods
    mockI2cBus = {
      closeSync: jest.fn(),
      writeI2cBlockSync: jest.fn().mockReturnValue(2),
      readI2cBlockSync: jest.fn().mockImplementation((_addr, _reg, _length, buffer) => {
        // Simulate ADC reading - return a 12-bit value in 16-bit format
        // Example: 0x7FF0 (2047 << 4) for max value
        buffer[0] = 0x7F;
        buffer[1] = 0xF0;
        return 2;
      }),
    } as any;

    (i2c.openSync as jest.Mock).mockReturnValue(mockI2cBus);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a mocked light service
    lightService = {
      analogInput1: {
        on: jest.fn(),
        off: jest.fn(),
      },
      analogInput2: {
        on: jest.fn(),
        off: jest.fn(),
      },
      analogInput3: {
        on: jest.fn(),
        off: jest.fn(),
      },
      update: jest.fn(),
    } as any as LightService;

    service = new AnalogInputService(lightService);
  });

  afterEach(() => {
    // Clean up - disable service to close I2C bus
    try {
      service.disable();
    } catch (error) {
      // Ignore errors during cleanup
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have inputs defined', () => {
    expect(service.input1).toBeDefined();
    expect(service.input2).toBeDefined();
    expect(service.input3).toBeDefined();
    expect(service.input4).toBeDefined();
  });

  it('should throw error when reading before enabling', () => {
    expect(() => service.read()).toThrow('AnalogInputService is not enabled. Call enable() first.');
  });

  describe('when enabled', () => {
    beforeEach(() => {
      service.enable();
    });

    it('should open I2C bus when enabled', () => {
      expect(i2c.openSync).toHaveBeenCalledWith(1);
    });

    it('should turn on analog input lights when enabled', () => {
      const lightSpy = jest.spyOn(lightService, 'update');
      service.disable();
      service.enable();
      expect(lightSpy).toHaveBeenCalled();
    });

    it('should be able to read all inputs', () => {
      expect(() => service.read()).not.toThrow();
    });

    it('should read correct channel for each input', () => {
      service.input1.read();
      // Check that config was written with channel 0 mux (0x4000)
      expect(mockI2cBus.writeI2cBlockSync).toHaveBeenCalled();

      jest.clearAllMocks();
      service.input2.read();
      // Check that config was written with channel 1 mux (0x5000)
      expect(mockI2cBus.writeI2cBlockSync).toHaveBeenCalled();
    });

    it('should return correct raw value', () => {
      const rawValue = service.input1.read();
      expect(rawValue).toBe(2047); // 0x7FF0 >> 4 = 0x7FF = 2047
      expect(service.input1.raw).toBe(2047);
    });

    it('should calculate voltage correctly', () => {
      service.input1.read();
      const voltage = service.input1.voltage;
      // Max ADC value (2047) should give ~25.85V
      // (2047 / 2047) * 4.096 * 13 = 53.248V
      expect(voltage).toBeCloseTo(53.248, 2);
    });

    it('should calculate percentage correctly', () => {
      service.input1.read();
      const percent = service.input1.percent;
      // Max ADC value should give 100%
      expect(percent).toBeCloseTo(100, 1);
    });

    it('should handle different ADC values', () => {
      // Mock half-scale reading
      mockI2cBus.readI2cBlockSync.mockImplementationOnce((_addr, _reg, _length, buffer) => {
        buffer[0] = 0x40; // 1024 << 4 = 0x4000
        buffer[1] = 0x00;
        return 2;
      });

      const rawValue = service.input1.read();
      expect(rawValue).toBe(1024);
      expect(service.input1.percent).toBeCloseTo(50, 1);
    });

    it('should throw error for invalid channel', () => {
      expect(() => service.readChannel(5)).toThrow('Invalid channel: 5. Must be 0-3.');
    });

    it('should close I2C bus when disabled', () => {
      service.disable();
      expect(mockI2cBus.closeSync).toHaveBeenCalled();
    });

    it('should turn off analog input lights when disabled', () => {
      const lightSpy = jest.spyOn(lightService, 'update');
      service.disable();
      expect(lightSpy).toHaveBeenCalled();
    });

    it('should handle multiple enable calls gracefully', () => {
      service.enable(); // Second enable call
      expect(i2c.openSync).toHaveBeenCalledTimes(1); // Should only open once
    });

    it('should handle multiple disable calls gracefully', () => {
      service.disable();
      service.disable(); // Second disable call
      expect(mockI2cBus.closeSync).toHaveBeenCalledTimes(1); // Should only close once
    });
  });

  describe('AnalogInput class', () => {
    let input: AnalogInput;

    beforeEach(() => {
      service.enable();
      input = service.input1;
    });

    it('should maintain state between reads', () => {
      input.read();
      const firstRaw = input.raw;
      const firstVoltage = input.voltage;
      const firstPercent = input.percent;

      // Values should be maintained without reading again
      expect(input.raw).toBe(firstRaw);
      expect(input.voltage).toBe(firstVoltage);
      expect(input.percent).toBe(firstPercent);
    });

    it('should update values on new read', () => {
      input.read();
      const firstRaw = input.raw;

      // Mock different reading
      mockI2cBus.readI2cBlockSync.mockImplementationOnce((_addr, _reg, _length, buffer) => {
        buffer[0] = 0x20;
        buffer[1] = 0x00;
        return 2;
      });

      input.read();
      const secondRaw = input.raw;

      expect(secondRaw).not.toBe(firstRaw);
    });
  });
});