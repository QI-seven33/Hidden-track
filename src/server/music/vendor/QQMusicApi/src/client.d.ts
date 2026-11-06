export class Client {
  constructor(options?: Record<string, unknown>);
  credential: any;
  song: any;
  search: any;
  user: any;
  login: any;
  execute(request: any): Promise<any>;
  close(): Promise<void>;
}
