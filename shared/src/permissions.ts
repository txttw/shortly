export enum Permissions {
    Grant_All = 'grant:all',
    Grant_Owned = 'grant:owned',
    // users
    User_Create = 'user:create',
    User_ReadAll = 'user:read_all',
    User_WriteAll = 'user:write_all',
    User_DeleteAll = 'user:delete_all',
    // links
    Link_Create = 'link:create',
    Link_ReadAll = 'link:read_all',
    Link_WriteAll = 'link:write_all',
    Link_DeleteAll = 'link:delete_all',
    // analytics
    Analytics_Read = 'analytics:read',
    Analytics_ReadAll = 'analytics:read_all',
    Analytics_ReadLive = 'analytics:read_live',
}
