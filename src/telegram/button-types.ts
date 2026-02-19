export type TelegramButtonStyle = "danger" | "success" | "primary";

export type TelegramInlineButton =
  | {
      text: string;
      callback_data: string;
      style?: TelegramButtonStyle;
    }
  | {
      text: string;
      web_app: { url: string };
    };

export type TelegramInlineButtons = TelegramInlineButton[][];
