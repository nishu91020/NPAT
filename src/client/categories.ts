import { CategoryInfo } from './types';

export const CATEGORIES: CategoryInfo[] = [
  {
    key: 'name',
    label: 'Name',
    placeholder: 'e.g., Sarah, Sam, Sid...',
    iconName: 'User',
    example: 'A person\'s first name',
  },
  {
    key: 'place',
    label: 'Place',
    placeholder: 'e.g., Spain, Sydney, Seattle...',
    iconName: 'MapPin',
    example: 'City, Country, State, River, Mountain',
  },
  {
    key: 'animal',
    label: 'Animal',
    placeholder: 'e.g., Shark, Snake, Squirrel...',
    iconName: 'Dog',
    example: 'Mammal, Bird, Fish, Insect, Reptile',
  },
  {
    key: 'thing',
    label: 'Thing',
    placeholder: 'e.g., Spoon, Scissors, Sword...',
    iconName: 'Package',
    example: 'Object, Item, Tool, Food, Vehicle',
  },
];

