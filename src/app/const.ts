export const isDevelopment =
    (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') && (!process.env.APP_ENV || process.env.APP_ENV === 'development');

export const isTest = process.env.APP_ENV === 'test';
