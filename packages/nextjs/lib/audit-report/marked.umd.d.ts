declare const mod: {
  marked: {
    parse: (md: string) => string;
    setOptions: (opts: { gfm?: boolean; breaks?: boolean }) => void;
  };
};
export = mod;
