const petGenerator = require('./petGenerator');
const constants = require('../src/constants');
const nbt = require('prismarine-nbt');
const helper = require('../src/helper');
const utils = require('util');
const parseNbt = utils.promisify(nbt.parse);

const getBackpackContents = async function (arraybuf) {
    const buf = Buffer.from(arraybuf);
    const data = nbt.simplify(await parseNbt(buf));

    const items = data.i;

    for (const [index, item] of items.entries()) {
        item.isInactive = true;
        item.inBackpack = true;
        item.item_index = index;
    }

    return items;
};

const parseItems = async function (base64, db) {
    const buf = Buffer.from(base64, 'base64');
    const data = nbt.simplify(await parseNbt(buf));

    const items = data.i;

    for (const [index, item] of items.entries()) {
        if (item.tag?.display?.Name.includes('Backpack')) {
            let backpackData;

            for (const key of Object.keys(item.tag.ExtraAttributes)) {
                if (key.endsWith('_data')) backpackData = item.tag.ExtraAttributes[key];
            }

            if (!Array.isArray(backpackData)) {
                continue;
            }

            const backpackContents = await getBackpackContents(backpackData);

            items.push(...backpackContents);
        }
    }

    for (const item of items) {
        if (item.tag?.ExtraAttributes?.id != undefined) {
            let itemName = helper.getRawLore(item.tag.display.Name);
            let itemId = item.tag.ExtraAttributes.id.toLowerCase();

            if (item.tag.ExtraAttributes.skin) {
                itemId = `${itemId}_skinned_${item.tag.ExtraAttributes.skin}`.toLowerCase();
            }

            if (item.tag.ExtraAttributes.dungeon_item_level > 0) {
                const dungeonItemLevel = item.tag.ExtraAttributes.dungeon_item_level;

                if (dungeonItemLevel > 5) {
                    const newStars = '⍟'.repeat(dungeonItemLevel - 5) + '✪'.repeat(5 - (dungeonItemLevel - 5));

                    itemName = itemName.replace(/✪/g, '') + newStars;
                }
            }

            const data = db[itemId];
            const ExtraAttributes = item.tag.ExtraAttributes;
            let price = data * item.Count;
            let base = data * item.Count;
            let calculation = [];

            //PRICE PAYED IN DARK AUCTION
            if (ExtraAttributes.winning_bid && !itemId.includes('hegemony')) {
                price = ExtraAttributes.winning_bid;
                calculation.push({
                    type: 'Winning Bid',
                    value: ExtraAttributes.winning_bid,
                });
            }

            //ENCHANTMENT BOOKS
            if (itemId == 'enchanted_book' && ExtraAttributes.enchantments) {
                const enchants = Object.keys(ExtraAttributes.enchantments);

                if (enchants.length == 1) {
                    const value = ExtraAttributes.enchantments[enchants[0]];

                    price = db[`${enchants[0]}_${value}`] ?? 0;
                    itemName = helper.capitalize(`${enchants[0]} ${value}`);
                    calculation.push({ type: 'Enchantment Book', value: price });
                }
            }

            if (ExtraAttributes.enchantments && itemId != 'enchanted_book') {
                for (const enchant of Object.entries(ExtraAttributes.enchantments)) {
                    if (constants.blocked_enchants[itemId]?.includes(enchant[0])) continue;

                    if (constants.allowed_enchants.includes(enchant[0])) {
                        if (enchant[0] === 'efficiency' && enchant[1] > 5 && itemId != 'stonk_pickaxe') {
                            price += (db[`sil_ex`] ?? 0) * (enchant[1] - 5) * 0.7;
                            calculation.push({
                                type: 'Silex',
                                value: (db[`sil_ex`] ?? 0) * (enchant[1] - 5) * 0.7,
                                count: enchant[1] - 5,
                            });
                        }

                        price += db[`${enchant[0]}_${enchant[1]}`] ?? 0;
                        calculation.push({
                            type: `${enchant[0]}_${enchant[1]}`,
                            value: db[`${enchant[0]}_${enchant[1]}`] ?? 0,
                        });
                    }
                }
            }

            //HOT POTATO BOOKS
            if (ExtraAttributes.hot_potato_count) {
                if (ExtraAttributes.hot_potato_count > 10) {
                    price += db['hot_potato_book'] || 0 * 10;
                    price += (db['fuming_potato_book'] || 0 * ExtraAttributes.hot_potato_count - 10) * 0.6;
                    calculation.push({
                        type: 'Hot Potato Books',
                        value: db['hot_potato_book'] || 0 * 10,
                        count: 10,
                    });
                    calculation.push({
                        type: 'Fuming Potato Books',
                        value: db['fuming_potato_book'] || 0 * ExtraAttributes.hot_potato_count - 10,
                        count: ExtraAttributes.hot_potato_count - 10,
                    });
                } else {
                    price += db['hot_potato_book'] || 0 * ExtraAttributes.hot_potato_count;
                    calculation.push({
                        type: 'Hot Potato Books',
                        value: db['hot_potato_book'] || 0 * ExtraAttributes.hot_potato_count,
                        count: ExtraAttributes.hot_potato_count,
                    });
                }
            }

            //ART OF WAR
            if (ExtraAttributes.art_of_war_count) {
                price += (db['the_art_of_war'] || 0 * ExtraAttributes.art_of_war_count) * 0.6;
                calculation.push({
                    type: 'The Art of War',
                    value: db['the_art_of_war'] || 0 * ExtraAttributes.art_of_war_count,
                    count: ExtraAttributes.art_of_war_count,
                });
            }

            //FARMING FOR DUMMIES
            if (ExtraAttributes.farming_for_dummies_count) {
                price += (db['farming_for_dummies'] || 0 * ExtraAttributes.farming_for_dummies_count) * 0.5;
                calculation.push({
                    type: 'Farming for Dummies',
                    value: db['farming_for_dummies'] || 0 * ExtraAttributes.farming_for_dummies_count,
                    count: ExtraAttributes.farming_for_dummies_count,
                });
            }

            if (ExtraAttributes.talisman_enrichment) {
                price += (db['talisman_enrichment_' + ExtraAttributes?.talisman_enrichment.toLowerCase()] || 0) * 0.75;
                calculation.push({
                    type: 'Enrichment: ' + ExtraAttributes?.talisman_enrichment.toLowerCase(),
                    value: db['talisman_enrichment_' + ExtraAttributes?.talisman_enrichment.toLowerCase()] || 0,
                    count: 1,
                });
            }

            //RECOMBS
            if (ExtraAttributes.rarity_upgrades > 0 && ExtraAttributes.originTag) {
                if (ExtraAttributes.enchantments || constants.talismans[itemId]) {
                    price += db['recombobulator_3000'] * 0.8;
                    calculation.push({
                        type: 'Recombobulator 3000',
                        value: db['recombobulator_3000'] * 0.8,
                        count: 1,
                    });
                }
            }

            //GEMSTONES
            if (ExtraAttributes.gems) {
                const gems = helper.parseItemGems(ExtraAttributes.gems);

                for (const gem of Object.values(gems)) {
                    price += db[`${gem.tier}_${gem.type}_gem`.toLowerCase()] ?? 0;
                    calculation.push({
                        type: `${gem.tier} ${gem.type} Gem`,
                        value: db[`${gem.tier}_${gem.type}_gem`.toLowerCase()] ?? 0,
                        count: 1,
                    });
                }
            }

            //REFORGES
            if (ExtraAttributes.modifier && !constants.talismans[itemId]) {
                const reforge = ExtraAttributes.modifier;

                if (constants.reforges[reforge]) {
                    price += db[constants.reforges[reforge]] ?? 0;
                    calculation.push({
                        type: constants.reforges[reforge] + ' Reforge',
                        value: db[constants.reforges[reforge]] ?? 0,
                        count: 1,
                    });
                }
            }

            //DUNGEON STARS
            if (ExtraAttributes.dungeon_item_level > 5) {
                const starsUsed = ExtraAttributes.dungeon_item_level - 5;

                for (const star of Array(starsUsed).keys()) {
                    price += db[constants.master_stars[star]] ?? 0;
                    calculation.push({
                        type: constants.master_stars[star],
                        value: db[constants.master_stars[star]] ?? 0,
                        count: 1,
                    });
                }
            }

            //NECRON BLADE SCROLLS
            if (ExtraAttributes.ability_scroll) {
                for (const item of Object.values(ExtraAttributes.ability_scroll)) {
                    price += db[item.toLowerCase()] ?? 0;
                    calculation.push({
                        type: item,
                        value: db[item.toLowerCase()] ?? 0,
                        count: 1,
                    });
                }
            }

            //GEMSTONE CHAMBERS
            if (ExtraAttributes.gemstone_slots) {
                price += ExtraAttributes.gemstone_slots * db['gemstone_chamber'] * 0.9;
                calculation.push({
                    type: 'Gemstone Chamber',
                    value: db['gemstone_chamber'] * ExtraAttributes.gemstone_slots,
                    count: ExtraAttributes.gemstone_slots,
                });
            }
            if (itemId === 'divan_chestplate' || itemId === 'divan_leggings' || itemId === 'divan_boots' || itemId === 'divan_helmet') {
                if (ExtraAttributes?.gems?.unlocked_slots) {
                    price += ExtraAttributes.gems.unlocked_slots.length * db['gemstone_chamber'] * 0.9;
                    calculation.push({
                        type: 'Gemstone Chamber',
                        value: db['gemstone_chamber'] * ExtraAttributes.gems.unlocked_slots.length,
                        count: ExtraAttributes.gems.unlocked_slots.length,
                    });
                }
            }

            //DRILLS
            if (ExtraAttributes.drill_part_upgrade_module) {
                price += db[ExtraAttributes.drill_part_upgrade_module] ?? 0;
                calculation.push({
                    type: ExtraAttributes.drill_part_upgrade_module + ' Drill Part Upgrade Module',
                    value: db[ExtraAttributes.drill_part_upgrade_module] ?? 0,
                    count: 1,
                });
            }

            if (ExtraAttributes.drill_part_fuel_tank) {
                price += db[ExtraAttributes.drill_part_fuel_tank] ?? 0;
                calculation.push({
                    type: ExtraAttributes.drill_part_fuel_tank + ' Drill Part Fuel Tank',
                    value: db[ExtraAttributes.drill_part_fuel_tank] ?? 0,
                    count: 1,
                });
            }

            if (ExtraAttributes.drill_part_engine) {
                price += db[ExtraAttributes.drill_part_engine] ?? 0;
                calculation.push({
                    type: ExtraAttributes.drill_part_engine + ' Drill Part Engine',
                    value: db[ExtraAttributes.drill_part_engine] ?? 0,
                    count: 1,
                });
            }

            //ETHERWARP (aotv)
            if (ExtraAttributes.ethermerge > 0) {
                price += db['etherwarp_conduit'] ?? 0;
                calculation.push({
                    type: 'Etherwarp Conduit',
                    value: db['etherwarp_conduit'] ?? 0,
                    count: 1,
                });
            }

            item.price = price ?? 0;
            item.modified = { id: itemId, name: itemName, calculation, base };
        }
    }

    return items;
};

const getItems = async function (profile, db) {
    const output = {};

    /*if (profile.sacks_counts) {
    let sacksValue = 0;

    for (const [index, count] of Object.entries(profile.sacks_counts)) {
      const sackPrice = db[index.toLowerCase()];
      if (sackPrice != undefined) {
        sacksValue += sackPrice * count ?? 0;
      }
    }

    output.sacks = sacksValue;
  }*/
    if (profile?.sacks_counts) {
        output.sacks = [];
        for (const [index, count] of Object.entries(profile.sacks_counts)) {
            const sackPrice = db[index.toLowerCase()];
            if (sackPrice != undefined) {
                output.sacks.push({
                    modified: {
                        id: index.toLowerCase(),
                        name: db[index.toLowerCase()]?.name || 'Unknown',
                    },
                    price: sackPrice * count,
                    Count: count,
                });
            }
        }
    }

    output.armor = profile.inv_armor ? await parseItems(profile.inv_armor.data, db) : [];
    output.wardrobe_inventory = profile.wardrobe_contents ? await parseItems(profile.wardrobe_contents.data, db) : [];
    output.inventory = profile.inv_contents ? await parseItems(profile.inv_contents.data, db) : [];
    output.enderchest = profile.ender_chest_contents ? await parseItems(profile.ender_chest_contents.data, db) : [];
    output.personal_vault = profile.personal_vault_contents ? await parseItems(profile.personal_vault_contents.data, db) : [];

    if (profile.backpack_contents) {
        const storage = [];

        for (const backpack of Object.values(profile.backpack_contents)) {
            const items = await parseItems(backpack.data, db);

            storage.push(items);
        }

        output.storage = storage.flat();
    }

    if (profile.pets) {
        const pets = [];

        for (const pet of profile.pets) {
            const petData = petGenerator.getPetPrice(pet, db);

            pets.push(petData);
        }

        output.pets = pets;
    }

    output.talismans = profile.talisman_bag ? await parseItems(profile.talisman_bag.data, db) : [];

    if (output.inventory.length == 0) {
        output.no_inventory = true;
    }

    return output;
};

module.exports = { getItems };