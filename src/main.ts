import { AnalogInputService } from './io/analog-input';
import { DigitalInputService } from './io/digital-input';
import { DigitalOutputService } from './io/digital-output';
import { LightService } from './io/light';
import { RelayService } from './io/relay';

// Re-export service classes and types for external use
export { AnalogInputService, AnalogInput } from './io/analog-input';
export { DigitalInputService } from './io/digital-input';
export { DigitalOutputService } from './io/digital-output';
export { LightService } from './io/light';
export { RelayService } from './io/relay';

export class AutomationHat {
  readonly analogInputs: AnalogInputService;
  readonly digitalInputs: DigitalInputService;
  readonly digitalOutputs: DigitalOutputService;
  readonly lights: LightService;
  readonly relays: RelayService;

  constructor() {
    this.lights = new LightService();
    this.analogInputs = new AnalogInputService(this.lights);
    this.digitalInputs = new DigitalInputService(this.lights);
    this.digitalOutputs = new DigitalOutputService(this.lights);
    this.relays = new RelayService(this.lights);
  }
}
