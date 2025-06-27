/**
 * Fix IDL format for Anchor BorshAccountsCoder compatibility
 * 
 * The issue: The IDL has account discriminators in the "accounts" section
 * but the actual type definitions are in the "types" section.
 * BorshAccountsCoder expects the account definitions to include the type info.
 * 
 * Additionally, field types are strings like "pubkey" instead of objects.
 */

export function fixIdlForAnchor(idl: any): any {
  const fixedIdl = JSON.parse(JSON.stringify(idl)); // Deep clone
  
  // Fix field types in the types section
  if (fixedIdl.types) {
    fixedIdl.types = fixedIdl.types.map((type: any) => {
      if (type.type && type.type.fields) {
        type.type.fields = type.type.fields.map((field: any) => {
          // If the type is a string, convert it to an object
          if (typeof field.type === 'string') {
            // Handle common type conversions
            if (field.type === 'pubkey') {
              field.type = { 
                array: ['u8', 32] 
              };
            } else {
              // Keep other types as is but wrapped in an object
              field.type = {
                defined: field.type
              };
            }
          }
          return field;
        });
      }
      return type;
    });
  }
  
  // Find account type definitions in the types section
  const accountTypes = new Map();
  
  if (fixedIdl.types) {
    for (const type of fixedIdl.types) {
      // Check if this type matches an account name
      const accountIndex = fixedIdl.accounts?.findIndex((acc: any) => acc.name === type.name);
      if (accountIndex !== -1) {
        accountTypes.set(type.name, type.type);
      }
    }
  }
  
  // Update accounts with their type definitions
  if (fixedIdl.accounts) {
    fixedIdl.accounts = fixedIdl.accounts.map((account: any) => {
      const typeDefinition = accountTypes.get(account.name);
      if (typeDefinition) {
        return {
          ...account,
          type: typeDefinition
        };
      }
      return account;
    });
  }
  
  return fixedIdl;
}