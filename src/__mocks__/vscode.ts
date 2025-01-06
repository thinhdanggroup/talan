export const ExtensionContext = jest.fn();
export const workspace = {
  getConfiguration: jest.fn()
};

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3
};

export type WorkspaceConfiguration = {
  get<T>(section: string): T | undefined;
  has(section: string): boolean;
  inspect<T>(section: string): undefined | {
    key: string;
    defaultValue?: T;
    globalValue?: T;
    workspaceValue?: T;
  };
  update(section: string, value: any): Thenable<void>;
};
